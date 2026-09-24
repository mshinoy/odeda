# Frontend rebuild plan

The React app in `frontend/` replaces the old dashboard view by view. This file is the
plan **and** the tracker. The status tables below are the only place progress is
recorded: agents pick tasks from them and update them in the same commit as the work, and
the owner reads them to see what is done. `git log -p PLAN.md` is the history.

Branch: `frontend-rebuild`.

## Starting an agent

Paste one of these into a fresh session.

- **Next task:** `Read PLAN.md and do the next task, following "How to work on a task".`
- **A specific task:** `Read PLAN.md and do T04, following "How to work on a task".`
- **In parallel:** `Read PLAN.md and do the next task in a worktree, following "How to work on a task" (parallel mode).`
- **Until a stop:** `/loop Read PLAN.md and do the next task, following "How to work on a task". Stop the loop when it says stop.`
- **Checkpoint approved:** `Checkpoint A is approved. Update PLAN.md accordingly.`

---

## Status

**Task statuses:** `todo` · `in progress (<who>, <date>)` · `done` · `blocked: <why>` ·
`needs decision: <question>`

**Checkpoint statuses:** `open` (phase in progress) · `ready for review` ·
`changes requested` · `approved`

| Phase | Checkpoint | Done |
|---|---|---|
| 0 Foundations | — | 10 / 10 |
| 1 Activities + gym | A: `open` | 0 / 9 |
| 2 Map & routes | B: `open` | 0 / 6 |
| 3 Health & trends | C: `open` | 0 / 5 |
| 4 Settings & finish | D: `open` | 0 / 5 |

### Phase 0 — Foundations (done)

| ID | Task | Commit |
|---|---|---|
| F0 | Audit of the old UI and API; plan approved | 2026-09-23 |
| F1 | Scaffold: Vite, React 19, TS strict, Tailwind v4, shadcn, ESLint/Prettier, `gen:api` | `542491d` |
| F2 | Typed activity API, columnar `/streams`; API client, query client, UI store, `format.ts` | `dd40edf` |
| F3 | Data layer: one `Activity` shape, `adapters.ts`, query hooks | `6c00cfb` |
| F4 | Old dashboard removed; FastAPI serves the React build; Docker builds it | `9770081` |
| F5 | Docs reconciled with what is true | `597f289` |
| F6 | Design tokens and the single-activity page (map + synced charts) | `b89f491` |
| F7 | Login page (login stays **off** by the owner's choice, see D2) | `5aca391` |
| F8 | Nav (Status replaces Today), type scale +1px, error screen, no-WebGL fallback | `139b3d3` |
| F9 | Status page: readiness, training load, race, sync strip | `76536e0`, `dfe2285` |
| F10 | First version of this plan, `scripts/dev-real-data.sh`, `frontend/scripts/screenshot.mjs` | `0fc53ed` |

### Phase 1 — Activities + gym · Checkpoint A: `open`

| ID | Task | Status | Depends on | Commit |
|---|---|---|---|---|
| T01 | Activity page: splits, HR zones, best efforts, and the D1 tweaks | in progress (claude-parallel, 2026-09-24) | — | |
| T15 | Gym data API: exercises from the saved activity data, and set/rep totals | in progress (claude-parallel, 2026-09-24) | — | |
| T02 | Activity list (gym rows show sets · reps) | todo | T15 | |
| T03a | Activity editing: the Edit dialog, saving only dirty fields | todo | T02 | |
| T03b | Activity editing: marks on edited fields, per-field revert, "revert all" | todo | T03a | |
| T03c | Activity editing: gear and route selects | todo | T03a | |
| T16 | Gym session page: body diagram and exercise table | todo | T15 | |
| T16b | Gym: relabel unlabelled (or wrong) exercises | todo | T16, T03b | |
| T17 | Status: "gym this week" | todo | T15 | |

### Phase 2 — Map & routes · Checkpoint B: `open`

| ID | Task | Status | Depends on | Commit |
|---|---|---|---|---|
| T04 | Map: all-activities heatmap | todo | — | |
| T05a | Routes: type the endpoints, plus the route list | todo | T04 | |
| T05b | Routes: route detail (segment-coloured map, attempts) | todo | T05a | |
| T05c | Routes: rename / merge / split dialogs | todo | T05b | |
| T06 | Route playback (TripsLayer) | todo | T05b | |
| T07 | Races and Compare 2–5 activities | todo | T05b | |

### Phase 3 — Health & trends · Checkpoint C: `open`

| ID | Task | Status | Depends on | Commit |
|---|---|---|---|---|
| T08 | Health: sleep, HRV, resting HR, Body Battery | todo | — | |
| T09 | Trends: performance (PBs, decoupling, EF, VO2max) | todo | — | |
| T10a | Trends: totals, year over year, distance by month | todo | T09 | |
| T10b | Trends: distributions, day × hour pattern | todo | T10a | |
| T10c | Trends: streaks, records, filters | todo | T10a | |

### Phase 4 — Settings & finish · Checkpoint D: `open`

| ID | Task | Status | Depends on | Commit |
|---|---|---|---|---|
| T11a | Settings: Garmin sign-in (password → MFA → ticket fallback) | todo | — | |
| T11b | Settings: sync, overrides summary, version, theme toggle | todo | — | |
| T12 | Gear: mileage, wear, CRUD, bulk reassign, defaults | todo | T11b | |
| T13 | Performance check: largest activity, heatmap, bundle size | todo | T04, T10c | |
| T14 | Cleanup and frontend README | todo | every other task | |

### Open decisions

None yet. When an agent needs the owner, it adds a row here (`D4`, `D5`, …) and sets
its task to `needs decision: <question>`.

| ID | Question | Status |
|---|---|---|

### Decided

| ID | Decision | Date |
|---|---|---|
| D1 | The current design (tokens, activity page, Status page) is the starting point, not a freeze. The owner will keep adjusting it at checkpoints. T01 applies the three tweaks: ~30 s pace smoothing, "/km" once on the axis, and checking the map background on real routes. | 2026-09-24 |
| D2 | Login stays off (`APP_PASSWORD` unset). There is no task to re-enable it. Keep the Login page code. | 2026-09-24 |
| D3 | "Events" in the brief means **races**. Gym sessions must also be shown properly: exercises, sets, reps and the muscles trained (T15–T17). | 2026-09-24 |

### Parked (not planned; ask the owner before starting)

- **Per-set gym detail** (each set's weight and reps, order and rest). This needs a new
  Garmin fetch of `/activity-service/activity/{id}/exerciseSets` in `ingest/`, plus a backfill.
- **`indoor_cardio` and `hiit` become `other`** in `activities` (`ingest/normalize.py`
  `TYPE_MAP`). The original typeKey survives only in the raw payload.

---

## Checkpoints

The owner reviews at the end of each phase. Agents never start a task in a later phase
until the earlier phase's checkpoint is `approved`.

**The agent that finishes the last task of a phase** also:
1. Writes the note below the phase's heading here: the commits (short hash and
   subject), which URLs to open, which real activities to try (ID and date), and
   anything it is unsure about. Keep it short, because the owner reads it on one screen.
2. Saves light and dark screenshots of every page the phase touched to
   `~/garmin-review/<A|B|C|D>/`. That folder is outside the repo; never commit screenshots.
3. Sets the checkpoint to `ready for review` in the phase table and the summary table,
   and commits `PLAN.md`.
4. Pushes: `git push origin frontend-rebuild`. If there is no `origin` remote, it says so
   in the note instead.
5. Stops and reports. This is a stop.

**The owner then:**
- **approves:** sets `approved`, or tells an agent "checkpoint A is approved". The agent
  sets it, deletes `~/garmin-review/A/` and commits. The next phase is open.
- **asks for changes:** writes bullets under "Owner feedback" and sets
  `changes requested`, or tells an agent. The next agent turns each bullet into a row in
  that phase's table (`A1`, `A2`, …, with the bullet as the task text and `—` as the
  dependency), commits `PLAN.md` on its own, then works them like any task. When the
  last one is done, it rewrites the note and repeats steps 2–5.
- **approves with leftovers:** "approve A, defer the rest". Rows not yet done move to
  the next phase's table, unchanged.

### Checkpoint A — Activities + gym

_Note: not written yet._

Owner feedback:

### Checkpoint B — Map & routes

_Note: not written yet._

Owner feedback:

### Checkpoint C — Health & trends

_Note: not written yet._

Owner feedback:

### Checkpoint D — Settings & finish

_Note: not written yet._

Owner feedback:

---

## How to work on a task (for agents)

1. **Read** this whole file, `CONTRIBUTING.md`, and the files the task card names.
2. **Pick.** Take the task you were given, or else:
   - If a checkpoint says `changes requested` and its feedback isn't in rows yet, do
     that first (see Checkpoints).
   - Otherwise, pick the first `todo` row in the **current phase** (the lowest-numbered
     phase whose checkpoint is not `approved`) whose dependencies are all `done`.
   - If every row in the current phase is `done` and the checkpoint is `open`, write the
     checkpoint (see Checkpoints).
   - If nothing is left to pick, **stop**. That happens when the checkpoint is
     `ready for review`, or when the remaining rows are `in progress`, `blocked` or
     waiting on a dependency.
   - Never start a row whose dependency is not `done`, or a row in a later phase.
3. **Claim** it with a commit that changes only its status to
   `in progress (<session name>, <date>)`, with subject `Claim <ID>`.
   - **Sequential mode (default):** commit in the main working tree on `frontend-rebuild`.
   - **Parallel mode:** create a worktree on a new branch `task/<ID>` from
     `frontend-rebuild`, commit the claim there, then publish it with
     `git -C /home/shinzy/garmin-analytics merge --ff-only task/<ID>`.
   - If the fast-forward fails, someone else moved the branch. Rebase onto
     `frontend-rebuild`. If the rebase conflicts on your row, the task has been taken:
     abandon the branch and pick again.
   - In parallel mode, never edit files in the main working tree.
4. **Build** it following the rules below.
   - Tick the card's `- [ ]` boxes as you finish each one, in the working tree; they are
     committed with the work.
   - **One task, one commit:** everything for the task goes in a single commit, so it can
     be reverted on its own.
5. **Verify** with the checklist in "Verifying a task". Do not mark a task done without
   having looked at the screenshots.
6. **Finish:**
   - Set the status to `done`, put the commit subject in the Commit column, and update
     that phase's count in the summary table.
   - Commit `PLAN.md` **in the same commit** as the work. Commit messages end with the
     attribution lines the session specifies.
   - In parallel mode, rebase `task/<ID>` onto `frontend-rebuild`. Conflicts in
     `PLAN.md` touch only rows, so keep both sides. Then
     `git -C /home/shinzy/garmin-analytics merge --ff-only task/<ID>` and remove the
     worktree.
   - If this was the last row of the phase, go on to the checkpoint.
7. **Stuck?** Set `blocked: <one line why>` or `needs decision: <the question>`, add a
   row under "Open decisions" if it's a question for the owner, and commit only
   `PLAN.md`: never half-done work. Then stop and report.
8. **Found something new?** Add a row (the next free `T` number) with a card below, in
   the phase where it belongs. Don't widen the task you are on.
9. **Push** only at a checkpoint.

## Rules (from the owner's brief; not optional)

**Code**
- Readable and easy to modify; explicit over clever. Small components: one per chart or
  map layer, with container / presentational separation.
- TypeScript strict. No `any`, no non-null `!`, no logic in JSX beyond simple conditionals.
- **Never hand-write API types.** Add a Pydantic model in
  `garmin_analytics/api/schemas.py`, then run `npm run gen:api`, and commit the
  regenerated `frontend/src/api/schema.ts`.
- Backend shape changes happen **only at the response boundary**: a field left out of a
  model is not serialised.
  - Units stay as stored (m, s, m/s, bpm, grams). Drop preformatted strings
    (`"4:52 /km"`) once their raw number is present.
  - Never change `ingest/`, `db/schema.sql`, stored data or the behaviour of
    `analytics/` functions to suit the UI. Reading `raw_documents` at the response
    boundary is fine; T15 does it.
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
- **The design will keep changing (D1), so keep it central.** Every colour, size, spacing,
  radius, font and chart style comes from `frontend/src/design/` (`tokens.ts`, scales,
  typography) or `frontend/src/charts/chrome.ts`. A design tweak should be a one-file
  change, never a hunt through views. If you need a value that isn't there, add a token
  rather than a literal.
- Calm and obvious: the map or chart is the hero, one focal point per screen, generous
  whitespace, progressive disclosure (summary first, detail on hover or click).
- Numbers over words. Labels are 1–2 words; no helper paragraphs.
- Stat cards: one big number, a small label, an optional delta. Nothing else.
- Numbers become strings **only** through `frontend/src/lib/format.ts`; never format
  inline. Per-sample metrics are defined once in `frontend/src/lib/metrics.ts`.
- **Colours only from `frontend/src/design/tokens.ts`**; no hex values in components.
  - Run is orange, ride violet, swim teal, the rest neutral, everywhere.
  - Blue is the one magnitude ramp (pace, HR, elevation, HR zones, muscle load).
  - Status colours always come with a label.
  - Palette changes must pass the colour-blind validator (see the F6 commit).
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
  root `.env`, without asking. Develop against a copy (below). Edits (overrides) are
  tested on the copy, never the live DB.

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

In parallel mode, use your own ports: add the task number to 8818 and 5180, e.g. T04 →
8822 / 5184.

- Look at both screenshots (light and dark), and read the printed console errors.
  - Any error from the app is a failure.
  - "Failed to initialize WebGL" means the screenshot browser has no GPU, not an app
    bug; the script already uses software WebGL.
- Use `localhost`, not `127.0.0.1`, for the Vite server: it listens on IPv6 only.
- Delete screenshots and stop your servers when done. The one exception is checkpoint
  screenshots in `~/garmin-review/`.
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
| Activity kinds (run/ride/swim/walk/strength/other) | `frontend/src/lib/activityKind.ts` |
| API models | `garmin_analytics/api/schemas.py` |
| Editable fields, overrides | `garmin_analytics/db/fields.py`; table `overrides` keyed by (`activity_id`, `field`) |
| Raw Garmin payloads | table `raw_documents`; `activities.raw_id` → `raw_documents.id`; `GET /api/raw/{endpoint}/{ref_key}` |
| Old UI, for reference | `git show 9770081~1:garmin_analytics/web/app.js` (also `map.js`, `index.html`) |

**Endpoints already typed:**
- Activities: `/api/activities`, `/api/activities/{id}` (GET, PATCH),
  `/api/activities/{id}/streams`, `/api/fields`
- Status: `/api/summary`, `/api/load`, `/api/readiness`, `/api/readiness/history`,
  `/api/race`, `/api/health`
- Sync: `/api/garmin/status`, `/api/sync/status`, `/api/sync/start`, `/api/sync/stop`
- Raw data: `/api/raw/{endpoint}/{ref_key}`

Everything else still returns `unknown` and has to be typed by the task that first uses it.

---

## Task cards

### T01 — Activity page: splits, HR zones, best efforts
- **Goal:** show the detail already loaded but not shown, below the charts and collapsed
  by default (progressive disclosure).
- **Files:** `features/activity/`. Data comes from `Activity.splits`, `hrZones` and
  `bestEfforts` (see `api/adapters.ts`).
- **Build:**
  - [ ] km splits as a compact bar chart (pace per km, faster is taller) with HR in the tooltip
  - [ ] time in HR zones as one horizontal stacked bar using `tokens.hrZones`, with zone labels
  - [ ] best efforts as a small table
  - [ ] ~30 s rolling smoothing for the pace line and the route colour (a pure helper
    in `lib/`, tested)
  - [ ] "/km" shown once on the pace axis, not on every tick
  - [ ] map background checked on 3+ real routes (city, park, out of town) in both themes; adjust via `design/` if it fights the route line
- **Old reference:** `openDrawer` in `app.js` (splits, zones, best efforts).
- **Done when:** the three blocks render on a real run, an indoor activity and a ride.
  Empty blocks are hidden, not shown empty.

### T15 — Gym data API
- **Goal:** expose the gym data that was downloaded with the activities but never read back.
- **What's there:**
  - There are 135 `strength_training` activities (2022-12 → 2026-09).
  - Each activity's raw payload (`activities.raw_id` → `raw_documents.payload`) carries
    `summarizedExerciseSets`, `totalSets`, `activeSets` and `totalReps`. A few `hiit`
    and `yoga` activities carry them too.
  - Each exercise has `category`, optional `subCategory`, `sets`, `reps`, `maxWeight`
    (grams), `volume` (grams × reps) and `duration` (ms).
  - About 71 exercises are `category: "UNKNOWN"`.
  - There is **no** muscle data and **no** per-set detail.
- **Backend:**
  - [ ] `GET /api/activities/{id}/exercises` returns `{ total_sets, active_sets,
    total_reps, exercises: [{ index, category, sub_category, sets, reps,
    max_weight_g, volume_g, duration_ms }] }`. `index` is the position in the payload
    (T16b keys relabels on it). For activities without the data, `exercises` is empty.
  - [ ] `total_sets` and `total_reps` on the activity list and detail responses (null
    when absent). Use `json_extract` in SQL so the list stays one query.
  - [ ] Pydantic models, `npm run gen:api`, and adapters that turn them into app
    shapes, with the units kept.
  - [ ] Tests with a small strength-payload fixture (not real data).
- **Rules:** read `raw_documents` at the response boundary. Don't touch `ingest/`,
  `db/schema.sql` or stored data.
- **Done when:** on the real-data copy, the 2026-09-14 session returns 6 exercises,
  14 sets and 135 reps.

### T02 — Activity list
- **Goal:** browse all activities. `/activities` becomes the list, and a row opens
  `/activities/:id`.
- **Backend:** `/api/activities` is typed already (filters: `type`, `start`, `end`, `q`,
  `sort`, `order`, `limit`, `offset`, `gear_id`, `route_id`). T15 adds set and rep totals.
- **Build:**
  - [ ] rows: date, name, kind badge, distance, time, pace (sport-aware), avg HR
  - [ ] gym rows (anything with `total_sets`) show sets · reps in place of distance and pace
  - [ ] sortable columns; filters in one row above: type, date range (default: the
    store's time range), name search (debounced)
  - [ ] paging, or "load more"
  - [ ] sort and filter state in the URL, so Back works
  - [ ] skeleton rows while loading; a one-line empty state with a "Clear filters" action
  - [ ] remove the temporary `activities` → latest-activity redirect in `routes.tsx`
- **Old reference:** `loadActivities` in `app.js`.
- **Done when:** sorting, filtering, paging and Back all work on real data, in both
  themes, and gym rows read well.

### T03a — Activity editing: the dialog
- **Goal:** fix what Garmin got wrong, from the activity page.
- **Backend:** `PATCH /api/activities/{id}` and `/api/fields` are typed already.
- **Build:**
  - [ ] an "Edit" dialog (shadcn) with fields generated from `/api/fields`
  - [ ] **send only dirty fields**, with correct types (the old UI sent every field as a
    string on every save)
  - [ ] keep a select's current value even when it isn't among the choices, so a save
    never silently retypes an activity
  - [ ] invalidate the activity, activities and summary queries on save
- **Old reference:** `drawerEditor` in `app.js`. Don't copy its bugs.
- **Done when:** an edit on the real-data copy shows up on the page, in the list and on
  Status.

### T03b — Activity editing: revert
- **Backend:** type `DELETE /api/activities/{id}/overrides/{field}` and
  `DELETE /api/activities/{id}/overrides`.
- **Build:**
  - [ ] edited fields are marked, in the dialog and on the page
  - [ ] per-field revert, and "revert all" with a confirm
  - [ ] invalidate as in T03a
- **Done when:** reverting brings back Garmin's value everywhere it is shown.

### T03c — Activity editing: gear and route
- **Backend:** type `PUT /api/activities/{id}/gear`, `PUT /api/activities/{id}/route`,
  `GET /api/gear` (for the selects).
- **Build:**
  - [ ] gear select per kind (shoes for runs, bikes for rides)
  - [ ] route select
  - [ ] invalidate the activity, activities and gear queries
- **Done when:** a gear change shows up in the list and on the activity page.

### T16 — Gym session page
- **Goal:** a gym session gets a page as good as a run's. The body diagram is the hero,
  as the map is for a run.
- **Files:** `features/activity/gym/`. `ActivityPage` picks the gym layout for any
  activity with exercises (strength, and HIIT or yoga when they have exercises).
- **Build:**
  - [ ] `frontend/src/lib/muscles.ts` (tested):
    - a `Muscle` type (~16 regions: chest, front / side / rear delts, biceps, triceps,
      forearms, abs, obliques, lats / upper back, traps, lower back, glutes, quads,
      hamstrings, calves)
    - a map from Garmin `category` (and `subCategory` where it changes the answer, e.g.
      `ROMANIAN_DEADLIFT`) to `{ primary, secondary }`
    - it covers every category in the real data; `UNKNOWN` maps to nothing
  - [ ] a pure `muscleLoad(exercises)` that returns a load per muscle (primary sets × 1,
    secondary sets × 0.5), tested
  - [ ] `BodyDiagram.tsx`: a hand-drawn inline SVG, front and back side by side, one path
    per muscle, shaded from the blue magnitude ramp in `tokens.ts`, with untrained
    muscles neutral. Light and dark. No new library.
  - [ ] exercise table: name, sets, reps, max weight, volume. Names come through
    `format.ts` (`BARBELL_DEADLIFT` → "Barbell deadlift", using the subcategory when
    present); `UNKNOWN` shows as "Unlabelled".
  - [ ] hover sync: hovering an exercise row highlights its muscles, and hovering a
    muscle highlights its exercises and shows its name
  - [ ] stat cards: duration, sets, reps, total volume, avg HR. The HR chart stays if
    samples exist (they usually do). No map.
  - [ ] weights and volume in kg via `format.ts`
- **Done when:** three real sessions look right in both themes, including 2026-09-14
  (which has an `UNKNOWN`) and one HIIT session.

### T16b — Gym: relabel exercises
- **Goal:** fix exercises Garmin got wrong or couldn't name, so the table and body
  diagram are right.
- **Storage:** the existing `overrides` table, with field `exercise:<index>` and value
  `CATEGORY` or `CATEGORY/SUB_CATEGORY`. No schema change.
  - Check that `/api/overrides`, the bulk override endpoint and `/api/fields` handle the
    new field names. They must not show up as unknown activity fields; group them as
    exercise relabels.
- **Backend:**
  - [ ] `PUT` and `DELETE /api/activities/{id}/exercises/{index}`, typed
  - [ ] the exercises endpoint applies relabels and marks those rows `edited`
- **Build:**
  - [ ] every exercise row can be relabelled from a select (the categories known to
    `lib/muscles.ts`); "Unlabelled" rows invite it
  - [ ] edited rows are marked and can be reverted, as in T03b
  - [ ] invalidate the exercises query; the body diagram updates
- **Done when:** on the real-data copy, a relabel survives a reload, updates the
  diagram, and a revert restores Garmin's label.

### T17 — Status: gym this week
- **Build:**
  - [ ] stat cards on Status for gym sessions and sets this week, with deltas against
    the 4-week average. Use the same week definition as `LoadPanel`.
  - [ ] data added to `/api/summary` at the response boundary (or a small typed
    endpoint if that's cleaner)
  - [ ] hidden when there are no gym sessions in the last 8 weeks
- **Done when:** it shows the right numbers on real data in both themes and doesn't
  crowd the page.

### T04 — Map: all-activities heatmap
- **Goal:** `/map` shows where you have been.
- **Backend:** type `GET /api/heatmap` (`type`, `start`, `end`, `precision`). It returns
  `points: [lat, lon, n][]`; a columnar or object shape is fine if that's cleaner.
- **Build:**
  - [ ] deck.gl `HeatmapLayer` from a pure `makeHeatmapLayer(...)`, weighted by
    `log1p(n)`, with colours from `tokens.metricRamp`
  - [ ] filters: type and time range
  - [ ] fit the view to the data
  - [ ] dark basemap in dark mode
- **Old reference:** `HeatLayer` in `map.js`, `loadHeatmap` in `app.js`.
- **Done when:** the heatmap renders for all activities and for filtered subsets, and
  panning stays smooth (note the frame rate in the commit).

### T05a — Routes: endpoints and list
- **Goal:** your recurring loops.
- **Backend:**
  - Type `GET /api/routes`, `/api/routes/{id}`, `/api/routes/{id}/segments`,
    `PATCH /api/routes/{id}`, `POST /api/routes/{id}/merge`,
    `POST /api/routes/{id}/split`, `DELETE /api/routes/{id}` and
    `POST /api/routes/recluster`.
  - Make `/api/activities/{id}/track` columnar like `/streams`, or drop it if `/streams`
    covers it.
- **Build:**
  - [ ] route list: name, attempts, distance, best and median time
  - [ ] reachable from the Map view and from an activity's route link
- **Old reference:** `renderRoutes` in `app.js`.

### T05b — Routes: detail
- **Build:**
  - [ ] `/routes/:id`: the route map coloured by the segments' relative speed ("where
    you speed up or slow down")
  - [ ] attempts table, best/median time, improvement
- **Old reference:** `openRoute` in `app.js`.
- **Done when:** a real route shows its segments and attempts.

### T05c — Routes: rename, merge, split
- **Build:**
  - [ ] rename, merge and split as shadcn dialogs (the old UI used `window.prompt` and
    never had a split button)
  - [ ] invalidate the routes queries
- **Done when:** each works on the real-data copy.

### T06 — Route playback
- **Goal:** replay an activity on its map (the one allowed decorative animation).
- **Build:**
  - [ ] deck.gl `TripsLayer` from a pure `makeTripsLayer(activity, ...)`, using
    `elapsedS` as timestamps
  - [ ] play/pause and a scrubber
  - [ ] the scrub position writes `hover` in the store, so the charts' crosshair follows
- **Done when:** playback runs smoothly on the longest GPS activity and syncs with the
  charts.

### T07 — Races and Compare
- **Races (D3):** Garmin tagged only 1 of ~487 activities as a race
  (`eventType.typeKey == "race"` in the raw payload), so races have to be marked by the owner.
  - [ ] a user-only editable field `race` (bool) in `db/fields.py`, like notes and RPE.
    When it isn't set, it falls back to the raw `eventType` at the response boundary.
  - [ ] a "Race" toggle in the Edit dialog, and a "Races" filter on the activity list
- **Compare:**
  - Backend: type `GET /api/routes/compare/tracks` and make its tracks columnar.
  - [ ] select 2–5 activities in the list (`selectedActivityIds` in the store)
  - [ ] `/compare` overlays their tracks, one colour each
  - [ ] pace and HR charts on a shared distance axis; hover syncs across all of them
  - [ ] "compare races at this distance" from a race's page
- **Colours:** more than 3 series needs a validated categorical palette. Check it against
  `tokens.ts` and the palette validator before adding colours.

### T08 — Health
- **Backend:** type `GET /api/trends` and `/api/daily`; `/api/readiness/history` is typed.
- **Build:**
  - [ ] sleep stages (stacked bars: deep, REM, light)
  - [ ] sleep score, HRV and resting HR, each with its 28-day rolling baseline
  - [ ] Body Battery high/low
  - [ ] baseline flags as stat-card deltas
  - [ ] readiness over 90 days
  - [ ] one metric per chart, and a shared time-range control
- **Old reference:** `renderRecovery` in `app.js`. It drew the stacked bars as three
  overlapping series; use real stacking.

### T09 — Trends: performance
- **Backend:** type `GET /api/performance`. Drop the preformatted `time`/`pace` strings.
- **Build:**
  - [ ] personal bests table
  - [ ] aerobic decoupling as a scatter plus a rolling mean, with the 5% line as a `markLine`
  - [ ] efficiency factor trend
  - [ ] VO2max trend
- **Old reference:** `renderPerformance`.

### T10a — Trends: totals and year over year
- **Backend:**
  - Type `GET /api/aggregate`, `/api/aggregate/filters`, `/api/aggregate/periods` and
    `/api/reports`.
  - Keep base units; the convenience `*_km` and `*_h` fields can be left out.
- **Build:**
  - [ ] totals as stat cards
  - [ ] year over year with deltas
  - [ ] distance by month
- **Old reference:** `renderAggregate`. Don't copy its bugs: its tooltips showed NaN, and
  it put dates on non-time axes.

### T10b — Trends: distributions and patterns
- **Build:**
  - [ ] pace, distance and HR-zone distributions
  - [ ] day-of-week × hour pattern

### T10c — Trends: streaks, records, filters
- **Build:**
  - [ ] streaks and records
  - [ ] filters (type, gear, dates) that apply to every Trends block

### T11a — Settings: Garmin sign-in
- **Backend:** type `/api/garmin/login`, `/mfa`, `/ticket`, `/signin-url` and `/disconnect`.
- **Build:**
  - [ ] password → MFA → the browser-ticket fallback that opens on a 503 (see
    `DECISIONS.md` D44)
  - [ ] a connected state with a disconnect action
- **Old reference:** the Garmin flow in `app.js`.

### T11b — Settings: sync, edits, about, theme
- **Backend:** type `/api/sync/estimate`, `/api/overrides` and `/api/config`.
- **Build:**
  - [ ] sync: estimate, start/stop, per-endpoint watermarks
  - [ ] summary of edits (overrides, including T16b's exercise relabels)
  - [ ] version, data range
  - [ ] light / dark / system theme toggle (extend `design/theme.ts`)
- **Old reference:** `renderSettings` in `app.js`.

### T12 — Gear
- **Backend:** type the remaining `/api/gear*` endpoints (CRUD, `bulk-assign`, `defaults`).
- **Build:**
  - [ ] gear cards with a wear bar against the retirement distance, and a "show retired"
    toggle
  - [ ] add/edit dialogs (the old UI used seven chained `window.prompt`s)
  - [ ] retire / delete
  - [ ] bulk reassign with a dry-run preview
  - [ ] default gear per activity type

### T13 — Performance check
- [ ] time the largest activity page and the all-activities heatmap (frame budget under
  16 ms on hover)
- [ ] check the bundle: the main chunk was ~317 kB gzipped as of F9, mostly ECharts.
  Lazy-load charts per route if needed.
- [ ] if a chart lags: add LTTB downsampling on the backend (an optional `max_points`)
  rather than in the browser
- Record the numbers in the commit message.

### T14 — Cleanup and frontend README
- [ ] `frontend/README.md`: how to run (dev, build, Docker), the folder structure, and
  "how to add a chart" and "how to add a map layer", each with a short example
- [ ] remove leftovers: dead components, unused tokens, TODOs
- [ ] update the note at the top of the root `README.md`
