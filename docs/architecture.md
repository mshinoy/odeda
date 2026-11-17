# Architecture, data model and security

How the pieces fit.

```
odeda/          Python package (FastAPI, stdlib sqlite3, no ORM)
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

In production FastAPI serves the build from `odeda/ui/`: `/assets/*` as
static files, and any other non-`/api` GET as `index.html` so client-side routes such
as `/login` work. One origin, so the `ga_session` cookie just works and there is no
CORS.


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
sync_status            resumable backfill progress, and the last automatic run
sessions, app_settings session cookies (hashed) and the app password hash (PBKDF2)
```

Full DDL: [`odeda/db/schema.sql`](../odeda/db/schema.sql).


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
* There is **no brute-force lockout** on the password — see [Honest limits](honest-limits.md).
