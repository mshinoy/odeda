#!/usr/bin/env bash
# Container-level verification, from a genuinely clean state.
#
# Everything here runs against the real image over HTTP — nothing is stubbed and
# nothing is asserted that was not actually observed. Everything goes to stdout;
# redirect it to keep a transcript.
#
#   ./scripts/verify_docker.sh            # full run, destroys and rebuilds the volume
#
# It deletes the garmin-analytics-data volume. That is the point (clean state), but
# do not run it against a deployment you care about.

set -uo pipefail
cd "$(dirname "$0")/.."

BASE="http://127.0.0.1:${GA_PUBLIC_PORT:-8000}"
COOKIE_JAR="$(mktemp)"
PASS=0
FAIL=0

hr()   { printf '\n=== %s ===\n' "$*"; }
ok()   { PASS=$((PASS + 1)); printf '  PASS  %s\n' "$*"; }
bad()  { FAIL=$((FAIL + 1)); printf '  FAIL  %s\n' "$*"; }

# check <description> <expected> <actual>
#
# An empty actual value is a failure, never a pass. Comparing "" with "" would
# otherwise report success for a check whose command silently died — which is
# exactly what happened to the gear-mileage comparison on the first run of this
# script, and it read as green.
check() {
  if [ -z "$3" ]; then
    bad "$1 — produced no value (the check itself failed)"
  elif [ "$2" = "$3" ]; then
    ok "$1 ($3)"
  else
    bad "$1 — expected $2, got $3"
  fi
}

# code <path> -> HTTP status, with the session cookie
code() {
  curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE_JAR" "$BASE$1"
}

# json <path> -> body (truncated), with the session cookie
json() {
  curl -s -b "$COOKIE_JAR" "$BASE$1"
}

trap 'rm -f "$COOKIE_JAR"' EXIT

printf 'Odeda — container verification\n'
printf 'date: %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
printf 'host: %s\n' "$(uname -srm)"
printf 'docker: %s\n' "$(docker --version)"
printf 'compose: %s\n' "$(docker compose version --short 2>/dev/null)"

# ---------------------------------------------------------------------------
hr "1. Clean state"
docker compose down --volumes --remove-orphans 2>&1 | sed 's/^/  /'
docker volume rm -f garmin-analytics-data >/dev/null 2>&1
if docker volume inspect garmin-analytics-data >/dev/null 2>&1; then
  bad "volume still present"
else
  ok "no garmin-analytics-data volume exists"
fi
printf '  disk before: %s\n' "$(df -h / | awk 'NR==2 {print $4" free ("$5" used)"}')"

# ---------------------------------------------------------------------------
hr "2. Build"
BUILD_START=$(date +%s)
if docker compose build 2>&1 | tail -3 | sed 's/^/  /'; then
  ok "image built"
else
  bad "build failed"
fi
printf '  build took %ss\n' "$(( $(date +%s) - BUILD_START ))"
printf '  image size: %s\n' "$(docker images odeda:latest --format '{{.Size}}')"

# ---------------------------------------------------------------------------
hr "3. Start from cold"
docker compose up -d 2>&1 | sed 's/^/  /'
printf '  waiting for /api/health ...\n'
UP_START=$(date +%s)
for _ in $(seq 1 180); do
  curl -fsS -o /dev/null "$BASE/api/health" 2>/dev/null && break
  sleep 2
done
if curl -fsS -o /dev/null "$BASE/api/health" 2>/dev/null; then
  ok "reachable after $(( $(date +%s) - UP_START ))s (includes first-run demo seeding)"
else
  bad "never became reachable"
fi

printf '  first-run log:\n'
docker compose logs 2>&1 | grep -E 'Seeding|days=|SYNTHETIC|Dashboard|Uvicorn running' \
  | sed 's/^/    /'

# Docker's own healthcheck, not ours.
for _ in $(seq 1 30); do
  HEALTH=$(docker inspect --format '{{.State.Health.Status}}' odeda 2>/dev/null)
  [ "$HEALTH" = "healthy" ] && break
  sleep 2
done
check "docker healthcheck" "healthy" "$HEALTH"
check "runs as non-root" "garmin" "$(docker compose exec -T app whoami 2>/dev/null | tr -d '\r')"
printf '  uid: %s\n' "$(docker compose exec -T app id 2>/dev/null | tr -d '\r')"

# ---------------------------------------------------------------------------
hr "4. No secrets in the image"
if docker run --rm --entrypoint sh odeda:latest -c \
   'ls -A /data 2>/dev/null; find / -name "oauth*token*.json" -o -name ".env" 2>/dev/null | head' \
   | grep -q .; then
  bad "image layer contains data or credentials"
else
  ok "no token cache, .env or database baked into the image"
fi
LAYER_ENV=$(docker history --no-trunc odeda:latest 2>/dev/null \
  | grep -ci 'APP_PASSWORD=[^ ]' || true)
check "no password in image history" "0" "$LAYER_ENV"

# ---------------------------------------------------------------------------
hr "5. Authentication gate"
check "/api/health is public"        "200" "$(code /api/health)"
check "/api/summary without cookie"  "401" "$(code /api/summary)"
check "/api/gear without cookie"     "401" "$(code /api/gear)"
check "/ redirects to login"         "302" "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/")"
check "/login is public"             "200" "$(code /login)"
# The image builds the React UI itself, so an unbuilt UI here is a broken image.
if curl -s "$BASE/login" | grep -q '<div id="root"'; then
  ok "/login serves the SPA's index.html"
else
  bad "/login does not serve the SPA (UI missing from the image?)"
fi
UI_ASSET=$(curl -s "$BASE/login" | grep -o '/assets/[^"]*\.js' | head -1)
check "SPA bundle is public"         "200" "$(code "$UI_ASSET")"

WRONG=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' \
  -d '{"password":"definitely-not-it"}' "$BASE/api/auth/login")
check "wrong password rejected"      "401" "$WRONG"

APP_PASSWORD=$(grep -E '^APP_PASSWORD=' .env | cut -d= -f2-)
RIGHT=$(curl -s -o /dev/null -w '%{http_code}' -c "$COOKIE_JAR" -X POST \
  -H 'Content-Type: application/json' \
  -d "{\"password\":\"${APP_PASSWORD}\"}" "$BASE/api/auth/login")
check "correct password accepted"    "200" "$RIGHT"
if grep -q 'ga_session' "$COOKIE_JAR"; then ok "session cookie issued"; else bad "no cookie"; fi
check "/api/summary with cookie"     "200" "$(code /api/summary)"
check "client route serves the SPA"  "200" "$(code /activities)"
check "unknown API path is still 404" "404" "$(code /api/does-not-exist)"

# ---------------------------------------------------------------------------
hr "6. Every endpoint, against the running container"
ACT=$(json '/api/activities?limit=1&has_gps=true' | python3 -c \
  'import sys,json; print(json.load(sys.stdin)["rows"][0]["activity_id"])')
ROUTE=$(json '/api/routes' | python3 -c \
  'import sys,json; print(json.load(sys.stdin)["routes"][0]["route_id"])')
GEAR=$(json '/api/gear' | python3 -c \
  'import sys,json; print(json.load(sys.stdin)["gear"][0]["gear_id"])')

for path in \
  "/api/health" "/api/config" "/api/doctor" "/api/fields" "/api/summary" \
  "/api/auth/status" "/api/garmin/status" \
  "/api/load" "/api/trends?days=180" "/api/readiness" "/api/readiness/history" \
  "/api/performance" "/api/race" "/api/reports" "/api/daily?days=90" \
  "/api/activities?limit=5" "/api/activities?type=running&sort=distance_m&order=desc" \
  "/api/activities?edited=false&has_gps=true" \
  "/api/activities/$ACT" "/api/activities/$ACT/track" \
  "/api/routes" "/api/routes?type=running" "/api/routes/$ROUTE" \
  "/api/routes/$ROUTE/segments" "/api/heatmap?precision=4" \
  "/api/gear" "/api/gear/$GEAR" \
  "/api/aggregate" "/api/aggregate?type=running" "/api/aggregate/filters" \
  "/api/aggregate/periods?period=year" \
  "/api/overrides" "/api/sync/status" "/api/sync/estimate" \
  "/api/raw/activities/$ACT" ; do
  STATUS=$(code "$path")
  SIZE=$(curl -s -b "$COOKIE_JAR" "$BASE$path" | wc -c)
  if [ "$STATUS" = "200" ] && [ "$SIZE" -gt 2 ]; then
    printf '  PASS  %-52s %s  %8s bytes\n' "$path" "$STATUS" "$SIZE"
    PASS=$((PASS + 1))
  else
    printf '  FAIL  %-52s %s  %8s bytes\n' "$path" "$STATUS" "$SIZE"
    FAIL=$((FAIL + 1))
  fi
done

hr "6b. Error handling"
check "unknown activity is 404"  "404" "$(code /api/activities/does-not-exist)"
check "unknown route is 404"     "404" "$(code /api/routes/999999)"
check "bad sort key is 400"      "400" "$(code '/api/activities?sort=nonsense')"
BADFIELD=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE_JAR" -X PATCH \
  -H 'Content-Type: application/json' -d '{"not_a_field":1}' \
  "$BASE/api/activities/$ACT")
check "unknown edit field is 400" "400" "$BADFIELD"
BADRPE=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE_JAR" -X PATCH \
  -H 'Content-Type: application/json' -d '{"rpe":99}' "$BASE/api/activities/$ACT")
check "out-of-range RPE is 400"  "400" "$BADRPE"
check "sync without an account is 409" "409" \
  "$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE_JAR" -X POST \
     -H 'Content-Type: application/json' -d '{}' "$BASE/api/sync/start")"

# ---------------------------------------------------------------------------
hr "7. Gear + override round trip, end to end"
printf '  activity under test: %s\n' "$ACT"

NEW_GEAR=$(curl -s -b "$COOKIE_JAR" -X POST -H 'Content-Type: application/json' \
  -d '{"kind":"shoe","brand":"Asics","model":"Novablast 5","nickname":"Round-trip shoes",
       "retirement_distance_m":800000,"purchase_date":"2026-09-01"}' \
  "$BASE/api/gear")
NEW_GEAR_ID=$(printf '%s' "$NEW_GEAR" | python3 -c 'import sys,json; print(json.load(sys.stdin)["gear_id"])')
printf '  created gear id %s\n' "$NEW_GEAR_ID"

curl -s -b "$COOKIE_JAR" -X PUT -H 'Content-Type: application/json' \
  -d "{\"gear_ids\":[$NEW_GEAR_ID]}" "$BASE/api/activities/$ACT/gear" >/dev/null

curl -s -b "$COOKIE_JAR" -X PATCH -H 'Content-Type: application/json' \
  -d '{"activity_name":"Corniche loop PB attempt","rpe":9,"notes":"held on"}' \
  "$BASE/api/activities/$ACT" >/dev/null

BEFORE=$(json "/api/activities/$ACT" | python3 -c '
import sys, json
d = json.load(sys.stdin)
a = d["activity"]
print(a["activity_name"], "|", a["rpe"], "|", a["notes"], "|",
      ",".join(g["display_name"] for g in d["gear"]))')
GEAR_BEFORE=$(json "/api/gear/$NEW_GEAR_ID" | python3 -c '
import sys, json
g = json.load(sys.stdin)["gear"]
print("%s km over %s activities, %s%% of threshold"
      % (g["total_distance_km"], g["activity_count"], g["retirement_pct"]))')
printf '  before re-sync: %s\n' "$BEFORE"
printf '  gear before   : %s\n' "$GEAR_BEFORE"

printf '  running a re-ingest that rewrites every activities row ...\n'
docker compose exec -T app odeda renormalize 2>&1 | tail -3 | sed 's/^/    /'

AFTER=$(json "/api/activities/$ACT" | python3 -c '
import sys, json
d = json.load(sys.stdin)
a = d["activity"]
print(a["activity_name"], "|", a["rpe"], "|", a["notes"], "|",
      ",".join(g["display_name"] for g in d["gear"]))')
GEAR_AFTER=$(json "/api/gear/$NEW_GEAR_ID" | python3 -c '
import sys, json
g = json.load(sys.stdin)["gear"]
print("%s km over %s activities, %s%% of threshold"
      % (g["total_distance_km"], g["activity_count"], g["retirement_pct"]))')
printf '  after re-sync : %s\n' "$AFTER"
printf '  gear after    : %s\n' "$GEAR_AFTER"

check "edits survived the re-ingest" "$BEFORE" "$AFTER"
check "gear mileage survived"        "$GEAR_BEFORE" "$GEAR_AFTER"

RAW_NAME=$(json "/api/raw/activities/$ACT" | python3 -c \
  'import sys,json; print(json.load(sys.stdin)["payload"].get("activityName"))')
printf '  Garmin still says: %s  (the override is masking it, not replacing it)\n' "$RAW_NAME"

printf '  bulk reassign preview:\n'
json_bulk=$(curl -s -b "$COOKIE_JAR" -X POST -H 'Content-Type: application/json' \
  -d '{"activity_type":"running","start":"2026-01-01","dry_run":true}' \
  "$BASE/api/gear/$NEW_GEAR_ID/bulk-assign")
printf '    %s\n' "$json_bulk"

printf '  reverting one field:\n'
curl -s -b "$COOKIE_JAR" -X DELETE \
  "$BASE/api/activities/$ACT/overrides/activity_name" \
  | python3 -c 'import sys,json; d=json.load(sys.stdin); print("    name is now:",
        d["activity"]["activity_name"], "(back to the Garmin value)")'

# ---------------------------------------------------------------------------
hr "8. Restart with data intact"
COUNTS_BEFORE=$(json /api/aggregate | python3 -c '
import sys, json
t = json.load(sys.stdin)["totals"]
print(t["activities"], t["distance_km"])')
EDITS_BEFORE=$(json /api/overrides | python3 -c 'import sys,json; print(json.load(sys.stdin)["total"])')
ROUTES_BEFORE=$(json /api/routes | python3 -c 'import sys,json; print(len(json.load(sys.stdin)["routes"]))')
printf '  before restart: activities+km=%s, edits=%s, routes=%s\n' \
  "$COUNTS_BEFORE" "$EDITS_BEFORE" "$ROUTES_BEFORE"

docker compose restart 2>&1 | sed 's/^/  /'
for _ in $(seq 1 90); do
  curl -fsS -o /dev/null "$BASE/api/health" 2>/dev/null && break
  sleep 2
done

COUNTS_AFTER=$(json /api/aggregate | python3 -c '
import sys, json
t = json.load(sys.stdin)["totals"]
print(t["activities"], t["distance_km"])')
EDITS_AFTER=$(json /api/overrides | python3 -c 'import sys,json; print(json.load(sys.stdin)["total"])')
ROUTES_AFTER=$(json /api/routes | python3 -c 'import sys,json; print(len(json.load(sys.stdin)["routes"]))')
printf '  after restart : activities+km=%s, edits=%s, routes=%s\n' \
  "$COUNTS_AFTER" "$EDITS_AFTER" "$ROUTES_AFTER"

check "activity data survived restart" "$COUNTS_BEFORE" "$COUNTS_AFTER"
check "user edits survived restart"    "$EDITS_BEFORE"  "$EDITS_AFTER"
check "routes survived restart"        "$ROUTES_BEFORE" "$ROUTES_AFTER"
check "session survived restart"       "200" "$(code /api/summary)"

# ---------------------------------------------------------------------------
hr "9. Housekeeping"
printf '  images: \n'
docker images --format '  {{.Repository}}:{{.Tag}}  {{.Size}}' | sed 's/^/  /'
printf '  build cache: %s\n' "$(docker system df --format '{{.Type}} {{.Size}}' 2>/dev/null \
  | grep -i 'build cache' || echo 'n/a')"
printf '  disk after: %s\n' "$(df -h / | awk 'NR==2 {print $4" free ("$5" used)"}')"

# ---------------------------------------------------------------------------
hr "Result"
printf '  %s passed, %s failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
