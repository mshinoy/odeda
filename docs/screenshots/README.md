# Screenshots

Captured from headless Chromium against the **synthetic seed** — no real account, no
personal data. `scripts/verify.sh` builds the same database. Regenerate with:

```bash
garmin-analytics seed --reset
garmin-analytics serve --port 8817 &
chromium-browser --headless --disable-gpu --no-sandbox --hide-scrollbars \
  --virtual-time-budget=30000 --window-size=1200,1650 \
  --screenshot="$HOME/routes.png" "http://127.0.0.1:8817/#routes/4"
```

Two gotchas:

* A snap-packaged Chromium cannot write into `/tmp`; point `--screenshot` somewhere
  under `$HOME`.
* Map tiles come from OpenStreetMap at render time. Taking many screenshots in quick
  succession gets throttled and you will capture a half-loaded tile grid — wait a
  minute between runs, or point `GA_TILE_URL` at your own tile server.

| File | Tab |
|---|---|
| `overview.png` | Overview — readiness hero, stats, baseline flags, trends |
| `load.png` | Training Load — CTL/ATL, TSB, daily TRIMP, weekly table |
| `recovery.png` | Sleep & Recovery — baselines, sleep stages, HRV, RHR, Body Battery |
| `activities.png` | Activities — sortable, filterable table |
| `activity-drawer.png` | Activity detail — map, edit form, gear dropdowns, linked charts |
| `routes.png` | Routes & Maps — route list, map, and the speed-up/slow-down profile |
| `aggregates.png` | Aggregates — lifetime totals, year over year, distributions, patterns |
| `gear.png` | Gear — mileage, wear against retirement threshold, bulk reassign |
| `settings.png` | Settings — Garmin connection, backfill progress, edit summary |
| `performance.png` | Performance — best efforts, decoupling, efficiency factor, VO2max |
| `race.png` | Race — countdown, projection, CTL trajectory |
