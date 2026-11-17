#!/bin/sh
# Install a garminconnect token cache produced elsewhere into the running container's
# data volume, then prove it landed.
#
#   ./scripts/install-tokens.sh /tmp/garmin-tokens
#
# Needed because Garmin refuses the login route from datacenter IPs — 429 on the mobile
# routes, 403 Cloudflare on the portal ones — so the login has to happen somewhere with
# a residential connection. The data endpoints are not blocked, which is why carrying
# the token file over is enough.
#
# Produce the source directory on the other machine with:
#   pip install garminconnect
#   python -c 'from garminconnect import Garmin; import getpass; \
#     g=Garmin(input("email: "), getpass.getpass()); g.login(); \
#     g.client.dump("/tmp/garmin-tokens")'
set -e

SRC="${1:-/tmp/garmin-tokens}"
CONTAINER="${GA_CONTAINER:-odeda}"
TOKEN_FILE=garmin_tokens.json

if [ ! -f "$SRC/$TOKEN_FILE" ]; then
  echo "ERROR: $SRC/$TOKEN_FILE not found." >&2
  if [ -f "$SRC/oauth1_token.json" ]; then
    echo "       That directory holds a garth-era cache (oauth1/oauth2 tokens)." >&2
    echo "       Those are a different format and no longer work — sign in again." >&2
  else
    echo "       Point this at the directory the login above wrote." >&2
  fi
  exit 1
fi

if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  echo "ERROR: container '$CONTAINER' is not running. Start it with: docker compose up -d" >&2
  exit 1
fi

echo "Installing tokens into $CONTAINER:/data/tokens"
docker cp "$SRC/$TOKEN_FILE" "$CONTAINER:/data/tokens/$TOKEN_FILE"

# The app runs unprivileged as uid 10001; docker cp lands files as root.
docker exec -u 0 "$CONTAINER" sh -c \
  'chown -R 10001:10001 /data/tokens && chmod 700 /data/tokens && chmod 600 /data/tokens/*'

echo
# doctor reports presence and file mode only — it never reads a token and never calls
# Garmin. So this confirms the cache landed, not that Garmin accepts it.
echo "Token cache as the app sees it:"
docker exec "$CONTAINER" odeda doctor 2>&1 | grep -i "garmin auth" || true

echo
echo "That checks the files exist, not that they work. The first real API call is:"
echo "    docker compose exec app odeda backfill --detail-limit 50"
echo
echo "Then delete your local copy — those files are credentials:"
echo "    rm -rf $SRC"
