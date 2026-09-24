# Frontend rebuild plan

The React app in `frontend/` replaces the old dashboard view by view. This file is the
plan **and** the tracker: the status table below is the single place progress is
recorded. Agents pick tasks from it and update it; people read it to see what is done.

Branch: `frontend-rebuild`. Last updated: 2026-09-24.

---

## Status

Statuses: `todo` · `in progress` · `done` · `blocked: <why>` · `needs decision: <question>`.

### Done

| ID | Task | Commit |
|---|---|---|
| F0 | Audit of the old UI and API; plan approved | 2026-09-23 |
| F1 | Scaffold: Vite, React 19, TS strict, Tailwind v4, shadcn, ESLint/Prettier, `gen:api` | `542491d` |
| F2 | Typed activity API, columnar `/streams`; API client, query client, UI store, `format.ts` | `dd40edf` |
| F3 | Data layer: one `Activity` shape, `adapters.ts`, query hooks | `6c00cfb` |
| F4 | Old dashboard removed; FastAPI serves the React build; Docker builds it | `9770081` |
| F5 | Docs reconciled with what is true | `597f289` |
| F6 | Design tokens and the single-activity page (map + synced charts) | `b89f491` |
| F7 | Login page (login is currently **switched off**, see D2) | `5aca391` |
| F8 | Nav (Status replaces Today), type scale +1px, error screen, no-WebGL fallback | `139b3d3` |
| F9 | Status page: readiness, training load, race, sync strip | `76536e0`, `dfe2285` |
| F10 | This plan, `scripts/dev-real-data.sh`, `frontend/scripts/screenshot.mjs` | "PLAN.md: the frontend plan and tracker…" |

### Decisions waiting on the owner

| ID | Question | Status |
|---|---|---|
| D1 | Approve the design (tokens + activity page + Status page)? Apply the three proposed tweaks: smooth the pace line (~30 s), show "/km" once instead of on every tick, check the map background on real routes? | needs decision |
| D2 | When to switch login back on. It is off for debugging: `APP_PASSWORD` is commented out in the root `.env` and the stored hash was cleared. To re-enable, uncomment it and restart. | needs decision |
| D3 | The brief says "runs, rides, **events**". Does "event" mean races (Garmin `eventType`), or something else? Needed before T07. | needs decision |

### Tasks

| ID | Task | Status | Depends on | Commit |
|---|---|---|---|---|
| T01 | Activity page: splits, HR zones, best efforts | todo | — | |
| T02 | Activity list | todo | — | |
| T03 | Activity editing: fields, per-field revert, gear, route | todo | T02 | |
| T04 | Map: all-activities heatmap | todo | — | |
| T05 | Routes: list, detail, segments, rename/merge/split | todo | T04 | |
| T06 | Route playback (TripsLayer) | todo | T05 | |
| T07 | Compare 2–5 activities | todo | T02, T05, D3 | |
| T08 | Health: sleep, HRV, resting HR, Body Battery | todo | — | |
| T09 | Trends: performance (PBs, decoupling, EF, VO2max) | todo | — | |
| T10 | Trends: aggregates (totals, year over year, distributions, patterns) | todo | T09 | |
| T11 | Settings: Garmin sign-in, sync, overrides summary, theme toggle | todo | — | |
| T12 | Gear: mileage, wear, CRUD, bulk reassign, defaults | todo | T11 | |
| T13 | Performance check: largest activity, heatmap, bundle size | todo | T04, T10 | |
| T14 | Cleanup and frontend README | todo | all above | |

---

## How to work on a task (for agents)

1. **Read** this whole file, `CONTRIBUTING.md`, and the files the task card names.
2. **Pick** the first `todo` task whose dependencies are all `done`, unless you were
   given a specific one. Never start a task whose dependency is not `done`.
3. **Claim it**: set its status to `in progress (<your name or session>, <date>)` in the
   table right away. No commit is needed; the working tree is shared.
4. **Build** it following the rules below. One task per commit.
5. **Verify** with the checklist in "Verifying a task". Do not mark a task done without
   having looked at the screenshots.
6. **Finish**: set the status to `done`, put the commit's subject line in the Commit
   column, update "Last updated", and commit `PLAN.md` **in the same commit** as the
   work. Commit messages end with the attribution lines the session specifies.
7. **Stuck?** Set `blocked: <one line why>` or `needs decision: <the question>`, add the
   question under "Decisions waiting on the owner", commit nothing half-done, and report.
8. **Found something new?** Add a task row (next free `T` number) with a card below.
   Don't widen the task you are on.

## Rules (from the owner's brief; not optional)

**Code**
- Readable and easy to modify; explicit over clever. Small components: one per chart or
  map layer, with container / presentational separation.
- TypeScript strict. No `any`, no non-null `!`, no logic in JSX beyond simple conditionals.
- **Never hand-write API types.** Add a Pydantic model in
  `garmin_analytics/api/schemas.py`, then run `npm run gen:api`, and commit the
  regenerated `frontend/src/api/schema.ts`.
- Backend shape changes happen **only at the response boundary**: a field left out of a
  model is not serialised. Units stay as stored (m, s, m/s, bpm). Drop preformatted
  strings (`"4:52 /km"`) once their raw number is present. Never change `ingest/`,
  `db/schema.sql`, stored data or the behaviour of `analytics/` functions to suit the UI.
- Backend payloads become app shapes in **one place**: `frontend/src/api/adapters.ts`.
- ECharts options come from pure `build<Name>Option(...)` functions and deck.gl layers
  from pure `make<Name>Layer(...)` functions, each unit-tested. Shared chart styling is
  in `frontend/src/charts/chrome.ts`.
- Cross-view state (selected activities, hover, time range) lives in
  `frontend/src/store/ui.ts`. Server data lives in TanStack Query; keys are in
  `frontend/src/api/queryClient.ts`. Invalidate those keys explicitly after a mutation.
- **No new npm or Python libraries without asking the owner.** Approved: React,
  react-router-dom, TanStack Query, Zustand, openapi-fetch/openapi-typescript,
  Tailwind, shadcn/ui (+ radix, lucide, cva, cn), ECharts/echarts-for-react,
  react-map-gl, maplibre-gl, mapbox-gl, deck.gl, turf, vitest. uPlot is allowed only if
  raw-stream charts lag.

**Design**
- Calm and obvious: the map or chart is the hero, one focal point per screen, generous
  whitespace, progressive disclosure (summary first, detail on hover or click).
- Numbers over words. Labels are 1–2 words; no helper paragraphs.
- Stat cards: one big number, a small label, an optional delta. Nothing else.
- Numbers become strings **only** through `frontend/src/lib/format.ts`; never format
  inline. Per-sample metrics are defined once in `frontend/src/lib/metrics.ts`.
- **Colours only from `frontend/src/design/tokens.ts`**; no hex values in components.
  Run is orange, ride violet, swim teal, the rest neutral, everywhere. Blue is the one
  magnitude ramp (pace, HR, elevation, HR zones). Status colours always come with a
  label. Palette changes must pass the colour-blind validator (see F6 commit).
- Light and dark mode for everything (follows the OS).
- Charts: minimal gridlines, no borders, one y-axis per chart (never two), no legend
  when context makes it obvious, hover crosshair, sensible defaults so nothing opens
  empty.
- Loading states are skeletons, not spinners. Empty states are one short line plus an
  action. Transitions 150–200 ms; no decorative animation except route playback.
- Nav stays at five items: Status · Activities · Map · Health · Trends. Settings and
  Gear sit behind the corner icon.

**Safety**
- Never commit tokens, passwords, `.env` files, the database or copies of it.
- Don't rebuild, stop or reconfigure the owner's running container, and don't edit the
  root `.env`, without asking. Develop against a copy (below).

## Verifying a task

```bash
# Backend (whenever garmin_analytics/ changed)
.venv/bin/pytest -q                              # must be fully green

# Frontend
cd frontend
npx prettier --write src && npm run typecheck && npm run lint && npm test && npm run build

# Real data, without touching the owner's container (needs it running):
scripts/dev-real-data.sh 8818                    # terminal 1: serves a copy of the live DB
cd frontend && VITE_API_URL=http://127.0.0.1:8818 npm run dev -- --port 5180   # terminal 2
node frontend/scripts/screenshot.mjs http://localhost:5180 /status ~/shot-light.png
node frontend/scripts/screenshot.mjs http://localhost:5180 /status ~/shot-dark.png --dark
```

- Look at both screenshots (light and dark), and read the printed console errors. Any
  error from the app is a failure. "Failed to initialize WebGL" means the screenshot
  browser has no GPU, not an app bug; the script already uses software WebGL.
- Use `localhost`, not `127.0.0.1`, for the Vite server: it listens on IPv6 only.
- Delete screenshots and stop your servers when done.
- Synthetic data (`garmin-analytics seed`) is for tests only. Views are checked on real
  data.

## Where things are

| What | Where |
|---|---|
| Routes | `frontend/src/routes.tsx` |
| One folder per view | `frontend/src/features/<view>/` (`<View>Page.tsx` is the container) |
| Shared components | `frontend/src/components/` (`StatCard`, `EmptyState`, `KindBadge`, `StatusDot`, `ui/` from shadcn) |
| Charts | `frontend/src/charts/` (`EChart.tsx` wrapper, `echarts.ts` registered parts, one folder per chart) |
| Map | `frontend/src/map/` (`BaseMap`, provider switch in `basemap.ts`, layers in `layers/`) |
| Tokens, scales, typography | `frontend/src/design/` |
| API models | `garmin_analytics/api/schemas.py` |
| Old UI, for reference | `git show 9770081~1:garmin_analytics/web/app.js` (also `map.js`, `index.html`) |

Endpoints already typed: `/api/activities`, `/api/activities/{id}` (GET, PATCH),
`/api/activities/{id}/streams`, `/api/fields`, `/api/summary`, `/api/load`,
`/api/readiness`, `/api/readiness/history`, `/api/race`, `/api/health`,
`/api/garmin/status`, `/api/sync/status`, `/api/sync/start`, `/api/sync/stop`.
Everything else still returns `unknown` and has to be typed by the task that first uses it.

---

## Task cards

### T01 — Activity page: splits, HR zones, best efforts
- **Goal:** show the detail already loaded but not shown, below the charts and collapsed
  by default (progressive disclosure).
- **Files:** `features/activity/`. Data comes from `Activity.splits`, `hrZones` and
  `bestEfforts` (see `api/adapters.ts`).
- **Build:**
  - km splits as a compact bar chart (pace per km, faster is taller) with HR in the tooltip
  - time in HR zones as one horizontal stacked bar using `tokens.hrZones`, with zone labels
  - best efforts as a small table
  - if D1 approves: ~30 s rolling smoothing for the pace line and the route colour
    (a pure helper in `lib/`, tested), and "/km" shown once on the pace axis
- **Old reference:** `openDrawer` in `app.js` (splits, zones, best efforts).
- **Done when:** the three blocks render on a real run, an indoor activity and a ride.
  Empty blocks are hidden, not shown empty.

### T02 — Activity list
- **Goal:** browse all activities. `/activities` becomes the list, and a row opens
  `/activities/:id`.
- **Backend:** `/api/activities` is typed already (filters: `type`, `start`, `end`, `q`,
  `sort`, `order`, `limit`, `offset`, `gear_id`, `route_id`).
- **Build:**
  - rows: date, name, kind badge, distance, time, pace (sport-aware), avg HR
  - sortable columns; filters in one row above: type, date range (default: the store's
    time range), name search (debounced)
  - paging, or "load more"
  - sort and filter state in the URL, so Back works
  - skeleton rows while loading; one-line empty state with a "Clear filters" action
  - remove the temporary `activities` → latest-activity redirect in `routes.tsx`
- **Old reference:** `loadActivities` in `app.js`.
- **Done when:** sorting, filtering, paging and Back all work on real data, in both themes.

### T03 — Activity editing
- **Goal:** fix what Garmin got wrong, from the activity page.
- **Backend:** type `DELETE /api/activities/{id}/overrides/{field}`,
  `DELETE /api/activities/{id}/overrides`, `PUT /api/activities/{id}/gear`,
  `PUT /api/activities/{id}/route`, `GET /api/gear` (needed for the selects).
  `PATCH` and `/api/fields` are typed already.
- **Build:**
  - an "Edit" dialog (shadcn) with fields generated from `/api/fields`
  - **send only dirty fields**
  - keep a select's current value even when it is not among the choices (the old UI did
    this so a save never silently retypes an activity)
  - edited fields are marked, with per-field revert and "revert all"
  - gear selects per kind
  - invalidate the activity, activities and summary queries on save
- **Old reference:** `drawerEditor` in `app.js`. Don't copy its bugs (it sent every
  field as a string on every save).
- **Done when:** editing, reverting and gear changes work and show up in the list and
  on Status, on a copy of real data (never the live DB).

### T04 — Map: all-activities heatmap
- **Goal:** `/map` shows where you have been.
- **Backend:** type `GET /api/heatmap` (`type`, `start`, `end`, `precision`). It returns
  `points: [lat, lon, n][]`; a columnar or object shape is fine if that's cleaner.
- **Build:**
  - deck.gl `HeatmapLayer` from a pure `makeHeatmapLayer(...)`, weighted by `log1p(n)`,
    with colours from `tokens.metricRamp`
  - filters: type and time range
  - fit the view to the data
  - dark basemap in dark mode
- **Old reference:** `HeatLayer` in `map.js`, `loadHeatmap` in `app.js`.
- **Done when:** the heatmap renders for all activities and for filtered subsets, and
  panning stays smooth (note the frame rate in the commit).

### T05 — Routes
- **Goal:** your recurring loops. List → `/routes/:id` with attempts and the segment
  profile ("where you speed up or slow down").
- **Backend:** type `GET /api/routes`, `/api/routes/{id}`, `/api/routes/{id}/segments`,
  `PATCH /api/routes/{id}`, `POST /api/routes/{id}/merge`, `POST /api/routes/{id}/split`,
  `DELETE /api/routes/{id}`, `POST /api/routes/recluster`. Make
  `/api/activities/{id}/track` columnar like `/streams`, or drop it if `/streams` covers it.
- **Build:**
  - route list (reachable from the Map view and from an activity's route link)
  - route map coloured by the segments' relative speed
  - attempts table, best/median time, improvement
  - rename / merge / split as dialogs (the old UI used `window.prompt`; the old UI never
    had a split button)
- **Old reference:** `renderRoutes` and `openRoute` in `app.js`.
- **Done when:** a real route shows its segments and attempts, and rename works on a copy.

### T06 — Route playback
- **Goal:** replay an activity on its map (the one allowed decorative animation).
- **Build:**
  - deck.gl `TripsLayer` from a pure `makeTripsLayer(activity, ...)` using `elapsedS`
    as timestamps
  - play/pause and a scrubber
  - the scrub position writes `hover` in the store, so the charts' crosshair follows
- **Done when:** playback runs smoothly on the longest GPS activity and syncs with the
  charts.

### T07 — Compare 2–5 activities
- **Blocked by D3.**
- **Backend:** type `GET /api/routes/compare/tracks` (make its tracks columnar).
- **Build:**
  - select activities in the list (`selectedActivityIds` in the store)
  - `/compare` overlays their tracks, one colour each
  - pace and HR charts on a shared distance axis
  - hover syncs across all of them
- **Colours:** comparing more than 3 series needs a validated categorical palette;
  check against `tokens.ts` and the palette validator before adding colours.

### T08 — Health
- **Backend:** type `GET /api/trends`, `/api/daily`; `/api/readiness/history` is typed.
- **Build:**
  - sleep stages (stacked bars: deep, REM, light)
  - sleep score, HRV, resting HR, each with its 28-day rolling baseline
  - Body Battery high/low
  - baseline flags as stat-card deltas
  - readiness over 90 days
  - one metric per chart, a shared time-range control
- **Old reference:** `renderRecovery` in `app.js` (it drew stacked bars as three
  overlapping series; use real stacking).

### T09 — Trends: performance
- **Backend:** type `GET /api/performance`. Drop the preformatted `time`/`pace` strings.
- **Build:**
  - personal bests table
  - aerobic decoupling as a scatter plus a rolling mean, with the 5% line as a `markLine`
  - efficiency factor trend
  - VO2max trend
- **Old reference:** `renderPerformance`.

### T10 — Trends: aggregates
- **Backend:** type `GET /api/aggregate`, `/api/aggregate/filters`,
  `/api/aggregate/periods`, `/api/reports`. Keep base units; convenience `*_km` and
  `*_h` fields can be left out.
- **Build:**
  - totals as stat cards
  - year over year with deltas
  - distance by month
  - pace / distance / HR-zone distributions
  - day-of-week × hour pattern
  - streaks and records
  - filters: type, gear, dates
- **Old reference:** `renderAggregate`. Don't copy its bugs: tooltips showed NaN and
  dates on non-time axes.

### T11 — Settings
- **Backend:** type `/api/garmin/login`, `/mfa`, `/ticket`, `/signin-url`,
  `/disconnect`, `/api/sync/estimate`, `/api/overrides`, `/api/config`, `/api/auth/*`.
- **Build:**
  - Garmin sign-in: password → MFA → the browser-ticket fallback that opens on a 503 (see
    `DECISIONS.md` D44)
  - sync: estimate, start/stop, per-endpoint watermarks
  - summary of edits (overrides)
  - version, data range
  - light / dark / system theme toggle (extend `design/theme.ts`)
- **Old reference:** `renderSettings` and the Garmin flow in `app.js`.

### T12 — Gear
- **Backend:** type the remaining `/api/gear*` endpoints (CRUD, `bulk-assign`, `defaults`).
- **Build:**
  - gear cards with a wear bar against the retirement distance, and a "show retired" toggle
  - add/edit dialogs (the old UI used seven chained `window.prompt`s)
  - retire / delete
  - bulk reassign with a dry-run preview
  - default gear per activity type

### T13 — Performance check
- Time the largest activity page and the all-activities heatmap (frame budget under 16 ms
  on hover).
- Check the bundle: main chunk ~317 kB gzipped as of F9, mostly ECharts. Lazy-load
  charts per route if needed.
- If a chart lags: add LTTB downsampling on the backend (optional `max_points`) rather
  than in the browser.
- Record the numbers in the commit message.

### T14 — Cleanup and frontend README
- `frontend/README.md`: how to run (dev, build, Docker), folder structure, and "how to
  add a chart" and "how to add a map layer", each with a short example.
- Remove leftovers: dead components, unused tokens, TODOs.
- Update the note at the top of the root `README.md`.
