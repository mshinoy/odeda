#!/bin/sh
# Install a garth token cache produced elsewhere (see garmin-login-local.py) into the
# running container's data volume, then prove it works against the live API.
#
#   ./scripts/install-tokens.sh /tmp/garmin-tokens
#
# Needed because Garmin's SSO login route 429s datacenter IPs, so the login has to
# happen on a residential connection. The data endpoints are not blocked, which is why
# carrying the tokens over is enough.
set -e

SRC="${1:-/tmp/garmin-tokens}"
CONTAINER="${GA_CONTAINER:-garmin-analytics}"

if [ ! -f "$SRC/oauth1_token.json" ]; then
  echo "ERROR: $SRC/oauth1_token.json not found." >&2
  echo "       Point this at the directory garmin-login-local.py wrote." >&2
  exit 1
fi

if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  echo "ERROR: container '$CONTAINER' is not running. Start it with: docker compose up -d" >&2
  exit 1
fi

echo "Installing tokens into $CONTAINER:/data/tokens"
for f in oauth1_token.json oauth2_token.json; do
  [ -f "$SRC/$f" ] && docker cp "$SRC/$f" "$CONTAINER:/data/tokens/$f"
done

# The app runs unprivileged as uid 10001; docker cp lands files as root.
docker exec -u 0 "$CONTAINER" sh -c \
  'chown -R 10001:10001 /data/tokens && chmod 700 /data/tokens && chmod 600 /data/tokens/*'

echo
# doctor reports presence and file mode only — it never reads a token and never calls
# Garmin. So this confirms the cache landed, not that Garmin accepts it.
echo "Token cache as the app sees it:"
docker exec "$CONTAINER" garmin-analytics doctor 2>&1 | grep -i "garmin auth" || true

echo
echo "That checks the files exist, not that they work. The first real API call is:"
echo "    docker compose exec app garmin-analytics backfill --detail-limit 50"
echo
echo "Then delete your local copy — those files are credentials:"
echo "    rm -rf $SRC"
