# Garmin Analytics — Build Spec (v2)

Self-hosted web application for deep analysis of a personal Garmin Connect history.
Docker-deployed, open-source-ready: anyone clones the repo, brings their own Garmin account,
and gets their own analytics. Built starting 2026-09-22.

**v2 supersedes v1.** The scope changed after the first brief: it is now a *shareable web product*,
not a personal script. Deployment, historical depth, route/map analytics and user-editable gear
are first-class requirements.

## Context that shapes this

- **Garmin has no self-serve API for individuals.** The Connect Developer Program (Health/Activity/
  Training API) is enterprise-only — confirmed 2026-09-17. Ingestion therefore uses:
  1. `python-garminconnect` (maintained Garmin Connect SSO client, MIT) — primary path, logs in
     as the user. Originally specified as `garth`; see DECISIONS.md D3 for why that changed.
  2. Garmin's official "Export Your Data" ZIP (GDPR export) — offline path, no credentials.
  3. Raw `.fit` / `.gpx` / `.tcx` files — full per-second streams including GPS.
- **Strava is not sufficient**: sleep, HRV, Body Battery, stress and training readiness never reach it.
- **Credentials are not available during the build** (user asleep). Everything must be provably working
  against realistic synthetic data, with real ingestion one command away.
- User is training for the **half marathon at the Doha Marathon by Ooredoo, Friday 15 January 2027, 07:35**.
- Disk was at 88%; npm cache and dangling Docker build cache were pruned → **~8.3 GB free**.
  Still finite. Do not leave stray images or multi-GB build caches behind.

## Deployment model — this is a product, not a script

**Single-tenant, self-hosted.** One deployment = one person's data. That is the honest POC shape:
no multi-user account system, no storing other people's Garmin passwords, no shared database.
People who want it run their own container.

Requirements:
- `docker compose up -d` is the *entire* install. Nothing else.
- `Dockerfile` — multi-stage, slim base, non-root user, healthcheck. Keep the final image lean.
- `docker-compose.yml` — app + named volume for the SQLite DB and token cache. No external DB service
  unless genuinely needed; a volume-backed SQLite file is right for one user.
- `.env.example` documenting every setting. **No secrets committed, ever.**
- The app is protected by a single password (`APP_PASSWORD` env, hashed at rest, session cookie).
  It must not be wide open to anyone who finds the port.
- Garmin login happens **through the web UI**, not by baking credentials into the image. First run shows
  a setup screen: enter Garmin email + password, handle MFA, token cache is written to the volume.
  Credentials are used once for token exchange and never persisted in plaintext.
- Works on ARM and x86 if that is free; do not burn hours on cross-build if it is not.

## Open-source hygiene

MIT `LICENSE`, `README.md` with a real screenshot and a 60-second quickstart, `CONTRIBUTING.md`,
`.env.example`, `.dockerignore`, `.gitignore` covering DB files, token caches, exports and `.env`.
**Zero personal data in the repo** — no real activity files, no real names, no real GPS traces.
A prominent, honest section on the unofficial-API caveat, ToS-grey status, and rate limits.

## Architecture

```
garmin_analytics/
  cli.py              # login | sync | import-zip | import-fit | seed | serve | doctor
  config.py
  db/
    schema.sql        # SQLite DDL + migrations table
    store.py
  ingest/
    connect.py        # Connect client: activities, sleep, HRV, RHR, body battery, stress,
                      #   steps, VO2max, training readiness/status, weight, gear
    details.py        # per-activity detail + GPS/HR/cadence/altitude streams
    export_zip.py     # Garmin official data-export ZIP parser
    fitfile.py        # fitdecode -> per-record streams
    backfill.py       # full-history walker: resumable, rate-limited, progress-reporting
    normalize.py
  analytics/
    load.py           # TRIMP, CTL(42d), ATL(7d), TSB, weekly ramp rate
    trends.py         # rolling baselines + z-scores: RHR, HRV, sleep, Body Battery
    performance.py    # rolling best efforts per distance, decoupling, efficiency factor, VO2max
    readiness.py      # composite daily readiness + race projection for 2027-01-15
    routes.py         # route clustering, per-route leaderboards, segment splits
    aggregate.py      # lifetime/yearly/monthly rollups, distributions, patterns
    reports.py
  api/server.py       # FastAPI: JSON + auth + static mount
  web/                # dashboard, vendored JS (uPlot + Leaflet), no CDN for app assets
seed/synthetic.py     # 3+ years of plausible fake data INCLUDING GPS tracks on repeated routes
tests/
```

## Historical depth

Pull **everything Garmin will give**, back to the beginning of the account — not a recent window.
The backfill must:
- Walk activities in pages until exhausted, oldest to newest, storing a resumable cursor.
- Fetch per-activity detail + streams for every activity (this is the expensive part — thousands of
  requests for a multi-year history). Rate-limit politely, back off on 429, checkpoint after every
  activity so an interrupted run resumes instead of restarting.
- Walk daily wellness endpoints day by day across the full account lifetime.
- Report progress (`n/total`, ETA) to stdout and to a `sync_status` endpoint the UI polls.
- Be safely re-runnable: idempotent upserts, watermark per endpoint.

Raw payloads are archived verbatim in `raw_documents` before normalising. Re-parsing must never
require re-fetching.

## Route & map analytics — go deep here

This is the headline feature. From GPS streams:

- **Route clustering.** Group activities that follow substantially the same path. Approach: downsample
  each track to a fixed number of points, snap to a geohash grid, build a signature, then cluster by
  signature similarity (start/end proximity + path overlap ratio). Tune so the user's regular loops
  collapse into one named route. Let the user **rename and merge/split** clusters — automatic clustering
  will get some wrong, and the UI must let them fix it.
- **Per-route history**: every attempt, pace/HR/time trend across attempts, best and worst, improvement
  over time, "you have run this 47 times" counts.
- **Segment analysis along a route**: split each track into fixed segments (e.g. 200 m or 1 km), then
  show **where the user speeds up and slows down** — median pace per segment across all attempts,
  variance, and correlated HR, elevation gradient and cadence. Surface the hills and the fade points.
- **Maps** (Leaflet, vendored; OSM raster tiles fetched at runtime — the one unavoidable external call,
  documented in the README):
  - Route polyline coloured by pace, HR, elevation or gradient — user-switchable.
  - Per-attempt track overlay to compare two runs of the same route.
  - Lifetime **heatmap** of all GPS points.
  - Click a point on the map → that moment's pace, HR, elevation, cadence; hover the chart → marker
    moves on the map. Chart and map must be linked both ways.
- Handle indoor/no-GPS activities gracefully: they simply have no route and must not break anything.

## Editing & gear — user-owned corrections

Garmin gets things wrong, and the user must be able to fix them **without their edits being clobbered
by the next sync**. Design requirement: user edits live in a separate `overrides` table keyed by
activity id + field; the read path is `COALESCE(override, garmin_value)`. Sync never overwrites an override.
Every override is timestamped and revertible ("reset to Garmin value").

**Gear management** (full CRUD, its own UI section):
- Shoes and bikes (and anything else: HRM straps, wheelsets), with brand, model, nickname, purchase date,
  initial distance offset, retirement threshold, retired flag, optional photo.
- Assign gear to an activity from a **dropdown**, retroactively, any time. e.g. change today's ride from
  one bike to another, or correct a run from "Asics Gel Nimbus 27" to "Novablast".
- **Bulk reassign**: apply gear to a filtered set (date range + activity type) in one action — essential
  when importing years of history that has no gear data.
- Default gear rules per activity type, applied to new activities only.
- **Gear mileage dashboard**: total distance and hours per item, distance since purchase, % of retirement
  threshold with a warning state, first/last use, activity count, and a pace/injury-adjacent view of
  distance-per-week on each item.
- Import gear from Garmin Connect where the API exposes it; never let a sync silently undo a manual change.

Other editable fields: activity title, activity type, notes, perceived effort (RPE 1–10),
private flag, and an **exclude-from-stats** flag (for that time the watch was left running in the car).

## Aggregate analytics — "go crazy"

Lifetime and per-period, filterable by activity type, date range and gear:
- Totals: activities, distance, time, elevation, calories — lifetime, per year, per month.
- "You have run 312 times over 5 years" style lifetime stats, with average pace, average speed,
  average HR, average distance, and how each has trended year over year.
- Distributions: pace histogram, HR-zone time split, distance histogram, duration histogram.
- Patterns: day-of-week and time-of-day heatmaps, month-of-year seasonality, consistency streaks
  (current and longest), most active week ever.
- Records wall: best 1 k / 5 k / 10 k / 15 k / HM / M / longest / most elevation / fastest average.
- Training load: CTL/ATL/TSB chart with ramp-rate warnings.
- Recovery: RHR, HRV, sleep score and Body Battery trends with rolling baselines and anomaly flags.
- Race panel: countdown to 2027-01-15, Riegel-projected HM time from recent bests, CTL trajectory.

## Dashboard

Single-page app, tabbed: **Overview · Activities · Routes & Maps · Performance · Recovery · Gear · Race · Settings**.
Dark theme, responsive down to a phone. Activities tab: sortable/filterable table with a detail view
containing the map, the linked streams chart, splits, and the edit/gear controls.
Charts via vendored uPlot; maps via vendored Leaflet. No CDN for application assets.

## Non-negotiables

1. **No credentials in code, chat, logs, git or image layers.** Token cache lives on the Docker volume,
   mode 0600. Never print tokens.
2. **Raw-first ingestion** — archive before normalising.
3. **Idempotent + incremental + resumable** sync. Re-running must never duplicate or clobber.
4. **User edits always win over synced values.**
5. **Offline app assets.** OSM map tiles are the sole documented runtime exception.
6. Pin every dependency. Keep the image lean; check `df -h /home` before and after heavy installs.

## Definition of done — demonstrated, not asserted

1. `pytest` green, with real assertions on the maths (TRIMP, CTL/ATL/TSB, Riegel, decoupling,
   route clustering on handcrafted tracks, override precedence, gear mileage totals).
2. `seed` loads 3+ years of synthetic data including **repeated GPS routes**, so clustering, segment
   analysis and maps have something real to chew on.
3. `docker compose up -d` builds and runs **from a clean state**; the app is reachable, login works,
   and the container survives a restart with data intact. Transcript in `VERIFICATION.md`.
4. Every API endpoint exercised with curl against the running container; responses non-empty and
   well-shaped; transcript saved.
5. The dashboard genuinely renders — map tiles, polylines, charts, gear dropdowns. Prove it. A headless
   screenshot is ideal *if* the browser stack is cheap; otherwise state plainly that verification was
   DOM/endpoint-level and that visual rendering is unconfirmed. Do not claim what was not checked.
6. Gear edit round-trip proven end to end: create shoe → assign to activity → re-run sync → **override
   survives** → mileage updates. This is the feature most likely to be silently broken; test it hardest.
7. `README.md` (what it is, quickstart, screenshot, data model, honest limits), `HANDOVER.md`
   (exactly what the user runs in the morning), `DECISIONS.md` (choices made without asking).
8. Clean git history, small meaningful commits, clean working tree, no secrets, no personal data.

## Morning handover

`HANDOVER.md`: the exact commands to connect the real account, expected first-backfill duration for a
multi-year history, MFA behaviour, what is stubbed, and — bluntly — anything that could not be tested
without credentials or without a browser.
