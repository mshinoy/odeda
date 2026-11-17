#!/bin/sh
# Container entrypoint.
#
# Responsibilities, in order:
#   1. make sure the data directory is usable and the token cache is 0700;
#   2. optionally seed synthetic demo data on a first run, so `docker compose up -d`
#      shows a working dashboard before anyone has connected an account;
#   3. hand off to the CLI.
#
# `set -e` so a failure here stops the container rather than starting a broken one.
set -e

DATA_DIR="${GA_DATA_DIR:-/data}"
TOKEN_DIR="${GA_TOKEN_DIR:-$DATA_DIR/tokens}"
DB_PATH="${GA_DB:-$DATA_DIR/garmin.db}"

# The container runs unprivileged (uid 10001) and so cannot chown its own volume.
# A named volume inherits the right ownership from the image; a bind mount does not,
# and the failure mode is an unexplained "mkdir: Permission denied". Say what to do.
if ! mkdir -p "$DATA_DIR" "$TOKEN_DIR" "${GA_RAW_DIR:-$DATA_DIR/raw_archive}" 2>/dev/null; then
  echo "ERROR: cannot write to $DATA_DIR as uid $(id -u)." >&2
  echo "       If you replaced the named volume with a bind mount, run:" >&2
  echo "           sudo chown -R 10001:10001 <host directory>" >&2
  exit 1
fi

# Tokens are credentials. Never world-readable, even inside a container.
chmod 700 "$TOKEN_DIR" 2>/dev/null || true

if [ -z "$APP_PASSWORD" ]; then
  echo "WARNING: APP_PASSWORD is not set — the dashboard is NOT password protected." >&2
  echo "         Set it in .env before exposing this port to anything but localhost." >&2
fi

# Seed demo data once, and only when there is no database yet. Opt-in: nobody
# wants synthetic data appearing in a deployment they meant for real data.
if [ "${GA_SEED_DEMO:-0}" = "1" ] && [ ! -f "$DB_PATH" ]; then
  echo "GA_SEED_DEMO=1 and no database yet — generating synthetic demo data."
  echo "This is NOT your training. Connect a Garmin account with"
  echo "  docker compose exec app odeda login"
  echo "then run a backfill to replace it."
  odeda seed --reset --months "${GA_SEED_MONTHS:-40}" || {
    echo "demo seeding failed; starting empty" >&2
    rm -f "$DB_PATH"
  }
fi

case "$1" in
  serve)
    shift
    exec odeda serve \
      --host "${GA_HOST:-0.0.0.0}" \
      --port "${GA_PORT:-8000}" "$@"
    ;;
  "")
    exec odeda serve --host "${GA_HOST:-0.0.0.0}" --port "${GA_PORT:-8000}"
    ;;
  *)
    # Anything else is passed straight to the CLI: `docker compose run --rm app doctor`,
    # `... app backfill`, `... app seed --reset`, and so on.
    exec odeda "$@"
    ;;
esac
