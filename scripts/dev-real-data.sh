#!/usr/bin/env bash
# Serve a COPY of the real database with the code in this checkout, for developing and
# screenshotting views against real data without touching the running container.
#
#   scripts/dev-real-data.sh [port]        # default port 8818
#   then, in frontend/:  VITE_API_URL=http://127.0.0.1:8818 npm run dev
#
# 1. Snapshots /data/garmin.db out of the running compose container with SQLite's online
#    backup (safe while the app runs; the live file is only read).
# 2. Removes the app password from the COPY only, so a headless browser needs no login.
# 3. Runs `odeda serve` on the copy in the foreground (Ctrl+C to stop).
#
# The copy lives in ~/.cache/garmin-dev/ and is overwritten on every run. It holds your
# real data: never commit it or copy it anywhere else.
set -euo pipefail

PORT="${1:-8818}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEV_DIR="${HOME}/.cache/garmin-dev"
CONTAINER="odeda"

mkdir -p "$DEV_DIR/raw" "$DEV_DIR/tokens"
chmod 700 "$DEV_DIR"

if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  echo "The '$CONTAINER' container is not running. Start it with: docker compose up -d" >&2
  exit 1
fi

echo "Snapshotting the live database from the container..."
docker exec "$CONTAINER" python -c "
import sqlite3
src = sqlite3.connect('file:/data/garmin.db?mode=ro', uri=True)
dst = sqlite3.connect('/tmp/garmin-dev-snapshot.db')
src.backup(dst)
dst.close()
"
docker cp "$CONTAINER:/tmp/garmin-dev-snapshot.db" "$DEV_DIR/garmin.db"
docker exec "$CONTAINER" rm -f /tmp/garmin-dev-snapshot.db
chmod 600 "$DEV_DIR/garmin.db"

"$ROOT/.venv/bin/python" - "$DEV_DIR/garmin.db" <<'PY'
import sqlite3, sys
db = sqlite3.connect(sys.argv[1])
db.execute("DELETE FROM app_settings WHERE key LIKE 'auth.password_%'")
db.execute("DELETE FROM sessions")
db.commit()
n = db.execute("SELECT count(*) FROM activities").fetchone()[0]
print(f"Copy ready: {n} activities, no password.")
PY

# Athlete settings from the root .env, so analytics match the real deployment.
set -a
# shellcheck disable=SC1091
[ -f "$ROOT/.env" ] && . <(grep -E '^(GA_HR_REST|GA_HR_MAX|GA_SEX|TZ)=' "$ROOT/.env")
set +a

echo "Serving the copy on http://127.0.0.1:${PORT} (Ctrl+C to stop)"
export GA_DATA_DIR="$DEV_DIR" GA_DB="$DEV_DIR/garmin.db" GA_RAW_DIR="$DEV_DIR/raw" GA_TOKEN_DIR="$DEV_DIR/tokens"
export APP_PASSWORD=""
exec "$ROOT/.venv/bin/odeda" serve --port "$PORT"
