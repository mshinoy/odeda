# Garmin Analytics

Self-hosted analytics over **your own** Garmin Connect history. Clone it, bring your
account, get your data — routes clustered into the loops you actually run, segment
analysis showing where you speed up and slow down, gear mileage, training load,
recovery trends, and lifetime aggregates over every activity you have ever recorded.

Single-tenant by design: one deployment is one person's data. There is no user
account system, no shared database, and nobody else's Garmin password anywhere.

> **The web UI is being rebuilt.** The old dashboard is gone; its replacement, a
> React app in [`frontend/`](frontend/), is being built view by view. Built so far:
> **Status** (readiness, training load, race projection, sync) and the single-activity
> page (route map and synced charts). Still to come: the activity list, Map, Health,
> Trends, and Settings and Gear behind a corner icon. Ingestion, analytics, the
> database and the JSON API all work today; for anything not built yet, use the CLI
> and the API. FastAPI's interactive docs are at `/docs`, behind the same session gate as the
> rest of the API.

---

## 60-second quickstart

```bash
git clone https://github.com/<you>/garmin-analytics.git
cd garmin-analytics
cp .env.example .env
$EDITOR .env                 # set APP_PASSWORD, and GA_SEED_DEMO=1 to look around first
docker compose up -d
```

The image builds the frontend in a Node stage and serves it from the same container
at <http://127.0.0.1:8000>.

If you seeded demo data, **wipe it before connecting a real account**, or your history
will sit alongside the fabricated activities: set `GA_SEED_DEMO=0` in `.env`, then
`docker compose down && docker volume rm garmin-analytics-data && docker compose up -d`.
That also drops the stored sessions and Garmin token.

Then connect Garmin and pull your history:

```bash
docker compose exec -it app garmin-analytics login
docker compose exec app garmin-analytics backfill --estimate   # size it first
docker compose exec app garmin-analytics backfill --detail-limit 50   # a trial run
docker compose exec app garmin-analytics backfill
```

Your Garmin password is used once to obtain a token and is never stored. If Garmin
refuses the login, see [Signing in to Garmin](#signing-in-to-garmin).

No Python or Node on the host, no database to provision.

<details>
<summary>Running without Docker</summary>

```bash
python -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt && pip install -e .

garmin-analytics seed --reset      # ~3 years of synthetic data, no account needed
garmin-analytics serve             # API on http://127.0.0.1:8808
```

`serve` also serves the built UI from `garmin_analytics/ui/`. That directory is a
build artifact, not source: build it with `cd frontend && npm ci && npm run build`.
Without it, every non-API page answers 503 with that hint, and the API works as
normal. For frontend development see [Development](#development).

For a real account: `garmin-analytics login`, then `garmin-analytics backfill`.
</details>

---

## What it does

Everything below is computed by the backend and served by the API. Which of it has a
screen yet: see the note at the top.

### Routes and maps

This is the part that does not exist elsewhere. Garmin shows you 163 unrelated
activities; what you actually have is **one route you have run 163 times**.

* **Clustering.** Tracks are resampled to a fixed number of points *by distance*, so
  a slow run and a fast run of the same loop line up. Two tracks are compared by
  symmetric path overlap — the fraction of each lying within 45 m of the other,
  taking the worse of the two, which is what stops a 5 km out-and-back being
  swallowed by the 10 km route that contains it.
* **Clustering gets some wrong, so you can fix it.** Rename, merge, split, or move a
  single activity. A route you have touched is *pinned* and never re-filed
  automatically.
* **Segment analysis** — the headline. Each attempt is split into fixed segments
  (200 m / 500 m / 1 km depending on route length), and each segment's speed is
  divided by *that attempt's own average* before aggregating. So the profile shows
  where **the route** is fast or slow rather than which days were, with median HR,
  gradient and cadence alongside.
* **Map data.** Per-activity tracks, a two-attempt comparison, a lifetime heatmap
  aggregated server-side onto a grid, and per-activity streams (`/streams`) as one
  column per channel with one entry per sample — lat/lon are null where there was no
  GPS, so a map and a chart index the same arrays.
* **Indoor activities degrade gracefully.** A treadmill run has no route and no
  track, and everything else still works.

### Your edits survive every sync

Garmin gets things wrong. The design point:

```
activities   ← what Garmin said.   A sync rewrites this freely.
overrides    ← what you said.      Nothing in the sync path touches it.
v_activities ← COALESCE(override, garmin_value).  Everything reads this.
```

A sync *cannot* clobber an edit, because there is no code path where it would even
look at the overrides table. Every edit is timestamped and revertible to the value
Garmin supplied. Editable: title, activity type, notes, RPE, private, and
exclude-from-stats — for the time you left the watch running in the car.

Excluding an activity removes it from *every* statistic, not just the obvious ones:
the training-load curve, the records wall, the lifetime totals, the streaks, the
weekly running volume and your shoes' mileage. Retyping a walk as a run moves it
between the per-sport totals everywhere for the same reason — everything reads the
same edit-resolved view.

Adding another editable field is an entry in [a registry](garmin_analytics/db/fields.py)
plus the matching attribute on the API's response model; the view DDL, validation and
the `/api/fields` description an editor is built from are generated from the registry.
See [CONTRIBUTING.md](CONTRIBUTING.md#adding-an-editable-field).

### Gear

Shoes, bikes, straps — brand, model, nickname, purchase date, an initial distance
offset for mileage they already had, and a retirement threshold with a warning state.

* Assign gear to **any** activity, retroactively, at any time.
* **Bulk reassign** across a date range and activity type — the only sane way to add
  gear to years of imported history that has none. A dry run tells you how many
  activities it would touch before you commit. By default it replaces an earlier
  assignment of the same kind; `only_unassigned` makes it additive.
* Default gear per activity type, applied to **new** activities only — backfilling
  four years of history with today's shoes would simply be a lie.
* Mileage counts activities you have not excluded from stats, so a bad GPS fix does
  not retire your shoes early.

### Aggregates

Lifetime and per-period, filterable by type, date range and gear: totals, "you have
run 833 times over 3.3 years at an average of 5:42/km", pace / distance / duration
histograms, HR-zone split, day-of-week and time-of-day heatmaps, seasonality,
consistency streaks, a records wall, and year-over-year change on every headline
metric.

Average pace is **distance-weighted** (total distance over total time), not the mean
of per-activity paces — otherwise a 400 m stride counts as much as a 30 km long run.

### And the rest

Training load (TRIMP → CTL/ATL/TSB with ramp-rate warnings), recovery trends against
rolling baselines (RHR, HRV, sleep, Body Battery) with anomaly flags, rolling best
efforts, aerobic decoupling, efficiency factor, VO2max, and a race panel with a
Riegel projection.

Best efforts are extracted from every activity that has a distance stream, but the
records wall and the race projection only read the foot-borne ones. A bike covers
5 km in nine minutes; letting that count as a "5 k PB" makes the wall meaningless
and the Riegel projection — a running formula — absurd. Ask the aggregates for
cycling and you get the cycling records, which is the case where you meant it.

---

## How data gets in

Garmin has **no self-serve API for individuals** — the Connect Developer Program is
enterprise-only. So there are three routes in, in order of convenience:

| Path | What it needs | What you get |
|---|---|---|
| Garmin Connect (default) | Your Garmin login | Everything, including sleep, HRV, Body Battery, stress, training readiness |
| Official data export | Garmin's GDPR export ZIP, no credentials | Most of it, as a one-off |
| `.fit` / `.gpx` / `.tcx` | The files themselves | Full per-second streams including GPS |

**The backfill pulls everything, back to the start of your account** — not a recent
window. For a multi-year account that is thousands of requests, so it:

* rate-limits politely and backs off exponentially on HTTP 429;
* **checkpoints after every single activity**, and derives its work queue from the
  database rather than an in-memory list, so killing it at request 4 000 of 6 000
  and re-running resumes at 4 001;
* reports progress, rate and ETA to stdout *and* to `/api/sync/status`;
* is safely re-runnable — archived payloads dedupe on content hash.

`backfill --estimate` gives the request count and a time range before you commit. On
the synthetic 3.3-year seed that was about 7 500 requests and 1¼–3 hours; the range
is derived from the configured per-request delay, and Garmin's real throttling is
undocumented. `backfill --detail-limit 50` fetches fifty activity streams and stops,
which tells you within minutes whether ingestion works at all.

`sync` walks a window of days and records a per-endpoint watermark. If a short test
sync has moved the watermarks to today, a later run resumes from today and skips the
years behind it; `sync --full` re-walks the whole `--days` window instead.

Raw payloads are archived **verbatim** before anything is normalised, so improving a
parser never means re-fetching. `garmin-analytics renormalize` rebuilds every table
from the archive with no network access at all.

### Signing in to Garmin

`garmin-analytics login` (or `POST /api/garmin/login`) takes your email and password,
handles MFA, and writes a token cache to `garmin_tokens.json` in the token directory
(`/data/tokens` in the container), mode 0600. The password is used for the token
exchange and discarded. The refresh token is long-lived, so this is a rare chore.

Garmin decides whether a sign-in looks like a browser before it looks at your
password. The client tries five sign-in routes and falls through on a rate limit or a
bot challenge; a 503 from the API (429 on the CLI) means all five were refused. That
is Garmin refusing the *address*, not the password — from one datacenter host on
2026-09-23 both mobile routes got 429 and both portal routes a 403 Cloudflare
challenge. The 429 lifts on its own. Meanwhile, use the **browser sign-in**, which
depends on no scripted login:

1. `garmin-analytics login --signin-url` prints a Garmin sign-in URL. Open it in any
   browser and sign in, including MFA. The page goes blank and the address bar ends
   with `?ticket=ST-…`.
2. `garmin-analytics login --ticket` and paste that URL. Tickets are single-use and
   expire in minutes; if one is rejected, sign in again for a fresh one.

Over HTTP: `GET /api/garmin/signin-url`, then `POST /api/garmin/ticket` with
`{"ticket": "…"}`. If you already hold a `garmin_tokens.json` from another machine,
`scripts/install-tokens.sh <dir>` copies it into the running container's volume. A
token cache from the old `garth` client is a different format and will not work.

Needing no login at all: request Garmin's official data export in your account
settings and `garmin-analytics import-zip` it. That gets history, not ongoing sync.

---

## Honest limits

Read this part.

* **The Garmin client is unofficial.**
  [`python-garminconnect`](https://github.com/cyberjunky/python-garminconnect) logs in
  as you through the same SSO flow the website uses. It is not a supported API, it is
  arguably against Garmin's terms of service, and **it can break without notice** when
  Garmin changes something. If ingestion stops working, that is the most likely reason;
  upgrading the pin in `requirements.txt` is the first thing to try.
* **Garmin may refuse to log you in from a server.** See
  [Signing in to Garmin](#signing-in-to-garmin); the browser sign-in is the reliable
  route from a datacenter address.
* **Rate limits are real and undocumented.** A first full backfill of a multi-year
  account issues thousands of requests. Do not run it repeatedly; it is resumable
  precisely so that you do not have to.
* **The basemap is fetched from a third party.** Application code is served from the
  container, but map style and tiles come from CARTO's free basemaps by default, or
  from Mapbox when `VITE_MAPBOX_TOKEN` is set. Point `VITE_MAP_STYLE_LIGHT` /
  `VITE_MAP_STYLE_DARK` at your own style to keep even that local. These are read at
  build time, so rebuild after changing them: `npm run build` locally, or
  `docker compose build` for the image, which takes them as build args from the root
  `.env`.
* **Single-tenant.** There is no multi-user support and none is planned. Run your own
  container.
* **`APP_PASSWORD` is one shared password, not an identity system.** It stops the
  port being wide open. It is not a substitute for not exposing the port.
* **`APP_PASSWORD` has no brute-force lockout.** A wrong guess costs the attacker
  one second and costs you one worker thread; there is no attempt counter and no
  ban. That is adequate behind localhost or a VPN and is *not* adequate on a public
  port. Use a long random password and put a reverse proxy in front if you expose it.
* **Garmin's login errors are passed through verbatim.** They distinguish a wrong
  password from an unapproved device, which is why; upstream puts the URL and status
  in them, not the request body, but that is upstream's behaviour, not something this
  code enforces.
* **Set `TZ`.** The container is UTC unless you say otherwise, and the race
  countdown, the current streak and the 28-day rolling volume are all computed for
  "today" in local time.
* **Re-clustering is synchronous.** `POST /api/routes/recluster` compares every GPS
  activity against every candidate route in the request thread — about thirteen
  seconds for five hundred tracks, and it grows faster than linearly.
* **This is a POC.** Ingestion has run against one real account: on 2026-09-23 it
  pulled 487 activities back to December 2022, with the activity, sleep and GPS-stream
  parsers checked against the real payloads. It has not been run for months on end,
  and long-running stability, concurrent browsers, ARM builds and databases past a few
  hundred megabytes are untested.

---

## Architecture

```
garmin_analytics/          Python package (FastAPI, stdlib sqlite3, no ORM)
  ingest/                  Garmin Connect client, backfill, export-ZIP and FIT parsers
  analytics/               load, trends, performance, readiness, routes, aggregates
  edits/                   overrides and gear
  db/                      schema.sql and the editable-field registry
  api/server.py            JSON API, session gate, and the built SPA
  api/schemas.py           Pydantic response models → /openapi.json
  ui/                      frontend build output (gitignored)
frontend/                  React 19 + TypeScript 5.9 (strict) + Vite
```

The frontend uses Tailwind v4 and shadcn/ui, TanStack Query for server state,
Zustand for UI state, ECharts for charts, and react-map-gl with deck.gl and turf for
maps, over MapLibre (or Mapbox with a token). Its API types are generated from
`/openapi.json` into `frontend/src/api/schema.ts`, which is committed so a build never
needs a running backend. Numbers become strings only in `frontend/src/lib/format.ts`;
the API returns values in the units they are stored in.

In production FastAPI serves the build from `garmin_analytics/ui/`: `/assets/*` as
static files, and any other non-`/api` GET as `index.html` so client-side routes such
as `/login` work. One origin, so the `ga_session` cookie just works and there is no
CORS.

---

## Data model

SQLite on a Docker volume. Stdlib `sqlite3`, no ORM.

```
raw_documents          verbatim payloads, deduped on content hash — the source of truth
activities             what Garmin said (a sync rewrites this)
activity_samples       per-sample streams: distance, HR, speed, cadence, altitude, lat/lon
overrides              what you said, per (activity, field) — a sync never touches it
v_activities           COALESCE(override, garmin_value) — what everything reads
v_activities_included  the same, minus anything excluded from stats — what aggregates read
gear, activity_gear    gear and its many-to-many assignment, with gear_defaults
routes, route_members  clusters of activities that follow the same path
route_segment_efforts  per-attempt, per-segment splits, cached
sleep, daily_wellness, hrv_daily, fitness, body_composition     per-day wellness
best_efforts           rolling best efforts extracted from sample streams
sync_status            resumable backfill progress
sessions, app_settings session cookies (hashed) and the app password hash (PBKDF2)
```

Full DDL: [`garmin_analytics/db/schema.sql`](garmin_analytics/db/schema.sql).

---

## Configuration

Backend settings are documented in [`.env.example`](.env.example). The ones that matter:

| Variable | Default | Notes |
|---|---|---|
| `APP_PASSWORD` | *(empty)* | **Set this.** Empty means no authentication at all. |
| `GA_COOKIE_SECURE` | `0` | Set to `1` when behind HTTPS. |
| `GA_SEED_DEMO` | `0` | `1` generates synthetic data on first start. |
| `GA_HR_REST` / `GA_HR_MAX` | 52 / 187 | Used by TRIMP and zone maths. |
| `TZ` | `Etc/UTC` | Your IANA zone. Anything anchored on "today" needs it. |

There is deliberately **no** `GARMIN_EMAIL` / `GARMIN_PASSWORD`. Credentials are
exchanged for a token and discarded.

Frontend settings are read by Vite at dev or build time. Locally they live in
[`frontend/.env`](frontend/.env.example); for the Docker image, put the three map
settings in the root `.env`, where `docker-compose.yml` forwards them as build args:

| Variable | Default | Notes |
|---|---|---|
| `VITE_API_URL` | `http://127.0.0.1:8000` | Where the dev server proxies `/api`. |
| `VITE_MAPBOX_TOKEN` | *(empty)* | Set to use Mapbox styles. It is a public token and ends up in the bundle — restrict it by URL in your Mapbox account. |
| `VITE_MAP_STYLE_LIGHT` / `VITE_MAP_STYLE_DARK` | CARTO positron / dark-matter | MapLibre style URLs. |

---

## CLI

```
garmin-analytics login          authenticate with Garmin Connect (once)
garmin-analytics login --signin-url / --ticket    browser sign-in, when Garmin refuses the above
garmin-analytics backfill       pull EVERYTHING back to the start of the account
garmin-analytics backfill --estimate    size the job before starting it
garmin-analytics sync           incremental pull (--full to re-walk the window)
garmin-analytics renormalize    re-parse the raw archive, no network
garmin-analytics cluster        (re)group GPS activities into routes
garmin-analytics import-zip     load Garmin's official data-export ZIP
garmin-analytics import-fit     load .fit files
garmin-analytics seed --reset   synthetic data for demos and tests
garmin-analytics serve          run the API and the built UI
garmin-analytics doctor         environment and data status (no credentials printed)
garmin-analytics report         today's readiness, load and race outlook
```

Inside Docker: `docker compose exec app garmin-analytics doctor`.

To back up everything — database, raw archive and token cache:

```bash
docker run --rm -v garmin-analytics-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/garmin-backup.tar.gz -C /data .
```

---

## Security notes

* `APP_PASSWORD` is stored **only** as a salted PBKDF2-SHA256 hash (240 000 rounds).
  Changing it rotates the hash and signs out every session.
* Session cookies are 256-bit random tokens; only their SHA-256 hash is stored, so a
  copy of the database cannot be replayed as a live session. Cookies are `HttpOnly`
  and `SameSite=Lax`.
* No CORS middleware: the UI is same-origin in production and proxied in development.
* The Garmin token cache lives on the volume at mode 0600, never in an image layer.
* The container runs as a non-root user (uid 10001) with `no-new-privileges`.
* Compose binds the port to `127.0.0.1` by default.
* `.gitignore` and `.dockerignore` both cover `.env`, token caches, databases and
  activity files. `.env.example` is the one deliberate exception.
* There is **no brute-force lockout** on the password — see Honest limits.

---

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md). Short version:

```bash
pip install -r requirements.txt && pip install -e .
garmin-analytics seed --reset       # no Garmin account needed to develop
garmin-analytics serve --port 8000  # the port the Vite proxy expects
pytest

cd frontend && npm ci
npm run dev                         # http://localhost:5173, /api proxied to VITE_API_URL
```

The seeder produces physiologically coupled data — an athlete model run forward day
by day, with an illness block, a travel block, cardiac drift, and **repeated GPS
routes with fixed hills** so that clustering and segment analysis have something real
to work on.

---

## Licence

MIT — see [LICENSE](LICENSE). Frontend dependencies are installed from npm under
their own licences (see `frontend/package.json`). The default basemap styles are
CARTO's, with OpenStreetMap data; their attribution terms apply.

Not affiliated with, endorsed by, or supported by Garmin.
