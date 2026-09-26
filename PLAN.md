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
| 0 Foundations | — | 11 / 11 |
| 1 Activities + gym | A: `approved` | 11 / 11 |
| 2 Map & routes | B: `approved` | 6 / 6 |
| 3 Health & trends | C: `approved` | 5 / 5 |
| 4 Settings & finish | D: `open` | 1 / 6 |

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

### Phase 1 — Activities + gym · Checkpoint A: `approved`

| ID | Task | Status | Depends on | Commit |
|---|---|---|---|---|
| T01 | Activity page: splits, HR zones, best efforts, and the D1 tweaks | done | — | Activity page: splits, HR zones, best efforts; 30 s pace smoothing, /km once |
| T15 | Gym data API: exercises from the saved activity data, and set/rep totals | done | — | Gym data API: exercises and set/rep totals from the raw payloads |
| T02 | Activity list (gym rows show sets · reps) | done | T15 | Activity list: sort, filter and page in the URL; gym rows show sets · reps |
| T03a | Activity editing: the Edit dialog, saving only dirty fields | done | T02 | Activity editing: an Edit dialog from /api/fields that saves only what changed |
| T03b | Activity editing: marks on edited fields, per-field revert, "revert all" | done | T03a | Activity editing: edited fields marked, revert one field or all of them |
| T03c | Activity editing: gear and route selects | done | T03a | Activity editing: gear and route selects in the dialog |
| T16 | Gym session page: body diagram and exercise table | done | T15 | Gym session page: a body diagram of what was trained, and the exercises |
| T16b | Gym: relabel unlabelled (or wrong) exercises | done | T16, T03b | Gym: relabel an exercise Garmin got wrong, and revert it |
| T17 | Status: "gym this week" | done | T15 | Status: gym sessions and sets this week against the 4-week average |
| T18 | Stream charts: sport-aware pace axis (km/h for rides, /100m for swims) | done | — | Stream charts: a ride's axis in km/h, a swim's in /100m |
| T19 | MapLibre: ship its worker so the no-token basemap draws | done | — | MapLibre: ship its worker, so a map without a Mapbox token has a background |

### Phase 2 — Map & routes · Checkpoint B: `approved`

| ID | Task | Status | Depends on | Commit |
|---|---|---|---|---|
| T04 | Map: all-activities heatmap | done | — | Map: an all-activities heatmap on /map, filtered by type and dates |
| T05a | Routes: type the endpoints, plus the route list | done | T04 | Routes: every route endpoint typed, and /routes lists your loops |
| T05b | Routes: route detail (segment-coloured map, attempts) | done | T05a | Routes: a route's page, coloured by where you speed up and slow down |
| T05c | Routes: rename / merge / split dialogs | done | T05b | Routes: rename, merge and split from the route's own page |
| T06 | Route playback (TripsLayer) | done | T05b | Route playback: replay an activity, with the charts following |
| T07 | Races and Compare 2–5 activities | done | T05b | Races you mark yourself, and 2–5 activities compared |

### Phase 3 — Health & trends · Checkpoint C: `approved`

| ID | Task | Status | Depends on | Commit |
|---|---|---|---|---|
| T08 | Health: sleep, HRV, resting HR, Body Battery | done | — | Health: your nights, your resting heart rate, and what sits off baseline |
| T09 | Trends: performance (PBs, decoupling, EF, VO2max) | done | — | Trends: your records, and whether your long runs hold together |
| T10a | Trends: totals, year over year, distance by month | done | T09 | Trends: what you have done, by month and by year |
| T10b | Trends: distributions, day × hour pattern | done | T10a | Trends: the shape of the history, and the week it happens in |
| T10c | Trends: streaks, records, filters | done | T10a | Trends: how consistent you have been, and one filter over all of it |

### Phase 4 — Settings & finish · Checkpoint D: `open`

| ID | Task | Status | Depends on | Commit |
|---|---|---|---|---|
| T11a | Settings: Garmin sign-in (password → MFA → ticket fallback) | done | — | Settings: connect a Garmin account, by password, by code or through a browser |
| T11b | Settings: sync, overrides summary, version, theme toggle | in progress (Patti, 2026-09-26) | — | |
| T12 | Gear: mileage, wear, CRUD, bulk reassign, defaults | todo | T11b | |
| T13 | Performance check: largest activity, heatmap, bundle size | todo | T04, T10c | |
| T20 | Prove the one-command install on the current image | todo | — | |
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

Eleven tasks: the activity page, the activity list, editing, the gym, and two fixes
found along the way.

| | |
|---|---|
| `f303e09` | Activity page: splits, HR zones, best efforts; 30 s pace smoothing, /km once |
| `c6a56cb` | Gym data API: exercises and set/rep totals from the raw payloads |
| `99541c6` | Activity list: sort, filter and page in the URL; gym rows show sets · reps |
| `d54f325` | Activity editing: an Edit dialog from /api/fields that saves only what changed |
| `52c8b74` | Activity editing: edited fields marked, revert one field or all of them |
| `3a88fef` | Activity editing: gear and route selects in the dialog |
| `d47fc8c` | Gym session page: a body diagram of what was trained, and the exercises |
| `0f5270a` | Gym: relabel an exercise Garmin got wrong, and revert it |
| `cc8bb21` | Status: gym sessions and sets this week against the 4-week average |
| `0659af6` | Stream charts: a ride's axis in km/h, a swim's in /100m |
| `3754c9b` | MapLibre: ship its worker, so a map without a Mapbox token has a background |

Also `de7e0a4` and `8b1548f`: the `ui-dev` and `api-dev` compose services this was all
built and checked on.

**To look at** (on http://localhost:5173, which is `ui-dev` on a copy of your data):

- `/status` — readiness, load, the race, and the two gym cards at the bottom.
- `/activities` — sort a column, change the dates, search, then press Back.
- `/activities/24458669412` — a run (Sep 22). Splits, HR zones and best efforts are
  collapsed under the charts. "Edit" opens the dialog; change the title, save, and it
  changes in the list too; the pencil mark and "↺" revert it.
- `/activities/24473027876` — a ride (Sep 23). Its charts and stat card now read km/h.
- `/activities/24358923702` — a gym session (Sep 14): the body diagram, and the
  "Unlabelled" row that can be relabelled from its own select.

Screenshots of all of these, light and dark, are in `~/garmin-review/A/`.

**Unsure about:**

- The activity list's column is headed "Pace" and holds "19.3 km/h" on a ride's row.
  One column, many sports; renaming it "Pace / speed" reads clumsy. Left as is.
- The gym cards sit at the bottom of Status, after the load charts. They may want to be
  higher on a week with no running.
- Swims cannot be checked properly: Garmin sends lengths, not samples, so none of the 24
  pool swims has a speed stream and their pages show heart rate alone.

Owner feedback: approved as-is on 2026-09-25, no changes requested. The three "Unsure
about" items were left as they are: the "Pace" column still shows km/h on a ride's row,
the gym cards stay at the bottom of Status, and swims remain unverifiable (Garmin sends
lengths, not samples). Raise them again if they grate in use.

### Checkpoint B — Map & routes

Six tasks: the heatmap, the route list and page, the route edits, route playback, and
races plus compare.

| | |
|---|---|
| `d228b4d` | Map: an all-activities heatmap on /map, filtered by type and dates |
| `38fec83` | Routes: every route endpoint typed, and /routes lists your loops |
| `7e51d6c` | Routes: a route's page, coloured by where you speed up and slow down |
| `dbd3170` | Routes: rename, merge and split from the route's own page |
| `0ccbe5f` | Route playback: replay an activity, with the charts following |
| `ad6fd1a` | Races you mark yourself, and 2–5 activities compared |

**To look at** (on http://localhost:5173):

- `/map` — every GPS point you have recorded. It opens on Qatar-to-Malaysia because
  your data really does span that; the type and date filters are how you zoom in.
  Try `2026-09-01` → `2026-09-24`, where the routes read as heat lines over Doha.
- `/routes` — 67 routes, busiest first. `/routes/31` is the 5.0 km loop with 65
  attempts: the map is coloured by where you are consistently fast or slow on it
  (hover a stretch), and every attempt is under it with its gap behind your best.
  "Rename", "Merge" and "Split" are on that page.
- `/activities/24458669412` — a run (Sep 22). New: a play button under the map. The
  trail, the clock and both charts' crosshairs move together. The route name in the
  header now opens `/routes/53`.
- `/activities` — rows have a tick box. Tick 2–5 and press Compare. "Races" filters
  to races and clears the dates when you switch it on.
- `/activities/13984719031` — the Ooredoo Marathon 10K, the one activity Garmin
  tagged as a race. "Race" is now a toggle in the Edit dialog, so you can mark the
  rest; mark a second 10 km and a "Compare races" button appears on this page.
- `/compare?ids=24375228851,24288179680,24275617434,24264030099` — four attempts at
  the 5.0 km loop overlaid, with pace and HR on a shared distance axis.

Screenshots of all of these, light and dark, are in `~/garmin-review/B/`.

**Unsure about:**

- **49 of your 67 routes have one or two attempts.** They are not loops, just
  activities the clusterer had nothing to pair with. The list is busiest-first so they
  sit at the bottom, but a "repeated only" filter might be worth it.
- **Long routes look stitched together.** A route's stored polyline is 100 points
  however long the route is, so on the 27.7 km ride (`/routes/67`, 500 m segments)
  some stretches hold fewer than two points and cannot be drawn. There is now a faint
  line under the segments so it reads as a route rather than as holes, but the cause is
  the resampling in `analytics/routes.py`, which is yours to say yes to.
- **Nothing here could be checked for smoothness.** This box has no GPU, so a drag
  costs ~233 ms a frame whether the map carries the 10,853-cell heatmap, one route, or
  nothing at all, and the replay runs at ~2 fps. T13 owns the real numbers.
- **The five compare colours clear a lower bar than the three sport colours.** Run,
  ride and swim stay 25 apart under every kind of colour blindness; five categorical
  colours cannot — see `design/palette.test.ts`, which is now the validator — so they
  clear 18 and always come with the table as a legend.
- `PATCH /api/routes/{id}` with no name now answers 422 instead of 400, because the
  body is a typed model. Nothing in the app sends that, but it is an API change.
- Adding `race` to the field registry changes the `v_activities` fingerprint, so your
  running container will rebuild the view the next time it starts. Nothing to do.

Owner feedback: approved as-is on 2026-09-25, no changes requested. Two things stay open
rather than fixed, and should be raised again if they grate in use: the route polyline is
still resampled to 100 points regardless of length (so long routes read as stitched, see
`/routes/67`), and there is still no "repeated only" filter to hide the 49 routes with one
or two attempts.

### Checkpoint C — Health & trends

Five tasks: the Health view, and the four blocks of Trends.

| | |
|---|---|
| `c820d73` | Health: your nights, your resting heart rate, and what sits off baseline |
| `f07d1a4` | Trends: your records, and whether your long runs hold together |
| `a95dda4` | Trends: what you have done, by month and by year |
| `3094fdf` | Trends: the shape of the history, and the week it happens in |
| `3c3357a` | Trends: how consistent you have been, and one filter over all of it |

Every remaining endpoint on these two views is now typed: `/api/trends`, `/api/daily`,
`/api/aggregate` and its two helpers, and `/api/reports`.

**To look at** (on http://localhost:5173):

- `/health` — the cards first, then sleep, resting HR, Body Battery and readiness.
  Change the window (90 days / 6 months / 1 year / 2 years); everything moves together
  and the URL follows. Sep 22 has no sleep bar because you recorded none.
- `/trends` — totals, distance by month, year over year, the three distributions, time
  in zones, the week grid, streaks, records, then the running block from T09.
- `/trends?type=running` — the same page for one sport. The "mixed sports" note leaves
  the Average pace card and a Pace column appears in the year table: 8:51 → 8:12 →
  8:25 → 8:54 /km. This is the view worth judging the page on.
- `/trends?start=2027-01-01` — a filter that matches nothing, which offers to clear
  itself.
- `/activities/24473027876` — the Sep 23 ride, which is the "Fastest average pace"
  record; `/activities/24458669412` is the Sep 22 run.

Screenshots of all of these, light and dark, are in `~/garmin-review/C/`.

**Three things about your data, not about the app:**

- **You have no HRV, ever.** All 1,402 raw `hrv` payloads are `{}`, so `hrv_daily` is
  empty, the Health card and chart never draw, and the readiness score is permanently
  missing one of its four components. Sleep score is nearly as bad: six days in four
  years, all from Oct–Nov 2023. Nothing was dropped on the way in; the watch does not
  send them.
- **Two pool swims carry 61 h and 47 h of moving time** (`/activities/` on 2025-10-20
  and 2025-11-03 — a watch left running). They are about 108 of the 409 hours on the
  Trends "Moving time" card, they own two rows of the records table, and they are why
  the duration distribution is not drawn at all: eighteen buckets collapse into one.
  Excluding an activity from statistics is your call, and the tick box is on its page.
- **Readiness holds a flat ~84 "prime" from 2026-07-22 to 2026-08-15.** Sleep, HRV and
  resting HR are all missing there, so the score falls back to form alone, which decays
  smoothly when nothing is being trained. Visible on `/health` and on `/status`. The
  chart draws what `/api/readiness/history` returns; whether that endpoint should answer
  at all on one component is `analytics/readiness.py`'s question, and yours.

**Unsure about:**

- **The year-over-year table has no Pace column until you pick a sport.** Across sports
  that number measures the sport mix, not speed (2025 reads 30:30 /km because it held
  long walks and gym work). Making the column appear with the filter seemed better than
  showing a number with a warning, but it does mean the default view is quieter than
  the old tab's.
- **2023 shows ▲ 14,153% on 2022**, because 2022 is one 2.6 km activity on December 27.
  It is arithmetically right and the row below explains it, but it is the loudest thing
  on the page. Say if you want the first partial year suppressed.
- **The sleep chart at "2 years" is 730 bars in about 1,060 px** and reads as texture
  rather than composition. It still shows where the gaps are, and the control is honest
  about what was asked for. The old UI capped that chart at 120 nights whatever the
  range, which lies about the window instead.
- **The Trends filter does not reach the running block** (records, decoupling,
  efficiency, VO₂max). `/api/performance` takes no parameters, and giving it any means
  teaching `analytics/performance` to filter. The block is labelled "all running, not
  filtered" when a filter is on; say if it should be taught.
- **The gear filter is invisible** because you have no gear. T12 creates it.
- T08's claim on 2026-09-25 was stale — that session left an uncommitted worktree and no
  commit. The work in it was reviewed, merged onto the current branch, and the worktree
  and its `task/T08` branch are gone.

960 backend tests, 606 frontend tests.

Owner feedback: approved by instruction on 2026-09-26, without walking the screenshots
or the pages. That is the owner's call, and it is recorded here rather than implied: the
five "Unsure about" items were not ruled on, so they stay as they are. The gear filter
(the fifth) stops being invisible when T12 creates gear. `~/garmin-review/C/` deleted.

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
  `/api/activities/{id}/streams`, `/api/activities/{id}/exercises`, `/api/fields`
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
  - [x] km splits as a compact bar chart (pace per km, faster is taller) with HR in the tooltip
  - [x] time in HR zones as one horizontal stacked bar using `tokens.hrZones`, with zone labels
  - [x] best efforts as a small table
  - [x] ~30 s rolling smoothing for the pace line and the route colour (a pure helper
    in `lib/`, tested)
  - [x] "/km" shown once on the pace axis, not on every tick
  - [x] map background checked on 3+ real routes (city, park, out of town) in both themes; adjust via `design/` if it fights the route line
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
  - [x] `GET /api/activities/{id}/exercises` returns `{ total_sets, active_sets,
    total_reps, exercises: [{ index, category, sub_category, sets, reps,
    max_weight_g, volume_g, duration_ms }] }`. `index` is the position in the payload
    (T16b keys relabels on it). For activities without the data, `exercises` is empty.
  - [x] `total_sets` and `total_reps` on the activity list and detail responses (null
    when absent). Use `json_extract` in SQL so the list stays one query.
  - [x] Pydantic models, `npm run gen:api`, and adapters that turn them into app
    shapes, with the units kept.
  - [x] Tests with a small strength-payload fixture (not real data).
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
  - [x] rows: date, name, kind badge, distance, time, pace (sport-aware), avg HR
  - [x] gym rows (anything with `total_sets`) show sets · reps in place of distance and pace
  - [x] sortable columns; filters in one row above: type, date range (default: the
    store's time range), name search (debounced)
  - [x] paging, or "load more"
  - [x] sort and filter state in the URL, so Back works
  - [x] skeleton rows while loading; a one-line empty state with a "Clear filters" action
  - [x] remove the temporary `activities` → latest-activity redirect in `routes.tsx`
- **Old reference:** `loadActivities` in `app.js`.
- **Done when:** sorting, filtering, paging and Back all work on real data, in both
  themes, and gym rows read well.

### T03a — Activity editing: the dialog
- **Goal:** fix what Garmin got wrong, from the activity page.
- **Backend:** `PATCH /api/activities/{id}` and `/api/fields` are typed already.
- **Build:**
  - [x] an "Edit" dialog (shadcn) with fields generated from `/api/fields`
  - [x] **send only dirty fields**, with correct types (the old UI sent every field as a
    string on every save)
  - [x] keep a select's current value even when it isn't among the choices, so a save
    never silently retypes an activity
  - [x] invalidate the activity, activities and summary queries on save
- **Old reference:** `drawerEditor` in `app.js`. Don't copy its bugs.
- **Done when:** an edit on the real-data copy shows up on the page, in the list and on
  Status.

### T03b — Activity editing: revert
- **Backend:** type `DELETE /api/activities/{id}/overrides/{field}` and
  `DELETE /api/activities/{id}/overrides`.
- **Build:**
  - [x] edited fields are marked, in the dialog and on the page
  - [x] per-field revert, and "revert all" with a confirm
  - [x] invalidate as in T03a
- **Done when:** reverting brings back Garmin's value everywhere it is shown.

### T03c — Activity editing: gear and route
- **Backend:** type `PUT /api/activities/{id}/gear`, `PUT /api/activities/{id}/route`,
  `GET /api/gear` (for the selects).
- **Build:**
  - [x] gear select per kind (shoes for runs, bikes for rides)
  - [x] route select
  - [x] invalidate the activity, activities and gear queries
- **Done when:** a gear change shows up in the list and on the activity page.
- **Also typed:** `GET /api/routes`, which the route select needs. T05a types the rest
  of the route endpoints.
- **Note:** the activity list has no gear column, so a gear change is only visible there
  through the row's `gear_ids`; the activity page header now shows the gear and the
  route. T12 owns showing gear.

### T16 — Gym session page
- **Goal:** a gym session gets a page as good as a run's. The body diagram is the hero,
  as the map is for a run.
- **Files:** `features/activity/gym/`. `ActivityPage` picks the gym layout for any
  activity with exercises (strength, and HIIT or yoga when they have exercises).
- **Build:**
  - [x] `frontend/src/lib/muscles.ts` (tested):
    - a `Muscle` type (~16 regions: chest, front / side / rear delts, biceps, triceps,
      forearms, abs, obliques, lats / upper back, traps, lower back, glutes, quads,
      hamstrings, calves)
    - a map from Garmin `category` (and `subCategory` where it changes the answer, e.g.
      `ROMANIAN_DEADLIFT`) to `{ primary, secondary }`
    - it covers every category in the real data; `UNKNOWN` maps to nothing
  - [x] a pure `muscleLoad(exercises)` that returns a load per muscle (primary sets × 1,
    secondary sets × 0.5), tested
  - [x] `BodyDiagram.tsx`: a hand-drawn inline SVG, front and back side by side, one path
    per muscle, shaded from the blue magnitude ramp in `tokens.ts`, with untrained
    muscles neutral. Light and dark. No new library.
  - [x] exercise table: name, sets, reps, max weight, volume. Names come through
    `format.ts` (`BARBELL_DEADLIFT` → "Barbell deadlift", using the subcategory when
    present); `UNKNOWN` shows as "Unlabelled".
  - [x] hover sync: hovering an exercise row highlights its muscles, and hovering a
    muscle highlights its exercises and shows its name
  - [x] stat cards: duration, sets, reps, total volume, avg HR. The HR chart stays if
    samples exist (they usually do). No map.
  - [x] weights and volume in kg via `format.ts`
- **Done when:** three real sessions look right in both themes, including 2026-09-14
  (which has an `UNKNOWN`) and one HIIT session.
- **Note:** the diagram sits beside the exercise table rather than full width — a figure
  has nothing to do with the width a map wants, and the hover sync needs both on screen.
  The old single-activity layout moved to `features/activity/EnduranceActivity.tsx`;
  `ActivityPage` now picks between that and the gym one.

### T16b — Gym: relabel exercises
- **Goal:** fix exercises Garmin got wrong or couldn't name, so the table and body
  diagram are right.
- **Storage:** the existing `overrides` table, with field `exercise:<index>` and value
  `CATEGORY` or `CATEGORY/SUB_CATEGORY`. No schema change.
  - Check that `/api/overrides`, the bulk override endpoint and `/api/fields` handle the
    new field names. They must not show up as unknown activity fields; group them as
    exercise relabels.
- **Backend:**
  - [x] `PUT` and `DELETE /api/activities/{id}/exercises/{index}`, typed
  - [x] the exercises endpoint applies relabels and marks those rows `edited`
- **Build:**
  - [x] every exercise row can be relabelled from a select (the categories known to
    `lib/muscles.ts`); "Unlabelled" rows invite it
  - [x] edited rows are marked and can be reverted, as in T03b
  - [x] invalidate the exercises query; the body diagram updates
- **Done when:** on the real-data copy, a relabel survives a reload, updates the
  diagram, and a revert restores Garmin's label.
- **Notes:**
  - The relabel vocabulary is not validated against a fixed list, only its shape, for
    the reason `activity_type` is not: Garmin adds exercises every year and a
    correction the server refuses is one the user cannot make.
  - `revert_all` (the Edit dialog's "Revert all") now leaves relabels alone. It counts
    only the field edits it shows, so throwing away work done on another screen would
    be a surprise; each relabel reverts from its own row.
  - A relabel still counts towards `override_count`, so a relabelled activity matches
    the list's `edited=true` filter. The page header's "Edited" mark stays about field
    edits; the relabel is marked on its own row.

### T17 — Status: gym this week
- **Build:**
  - [x] stat cards on Status for gym sessions and sets this week, with deltas against
    the 4-week average. Use the same week definition as `LoadPanel`.
  - [x] data added to `/api/summary` at the response boundary (or a small typed
    endpoint if that's cleaner)
  - [x] hidden when there are no gym sessions in the last 8 weeks
- **Done when:** it shows the right numbers on real data in both themes and doesn't
  crowd the page.

### T18 — Stream charts: sport-aware pace axis
- **Found in:** T01, on the 2026-09-23 Al Daayen ride (24473027876).
- **Problem:** the stream "Pace" chart plots s/km for every sport, so a ride's axis
  reads "–, 5:00, 10:00" (the top tick is 0 s/km) while its header, splits and legend say km/h.
- **Build:**
  - [x] rides (and other speed sports) plot km/h, higher at the top; swims plot /100m;
    runs and walks keep s/km inverted. Reuse the units of `formatSportSpeed`.
  - [x] the unit shown once on the top tick, as T01 did for /km
  - [x] tooltip and crosshair in the same unit
- **Done when:** a real ride, run and swim read in their own unit.
- **Notes:**
  - The chart's label follows the unit: a ride's chart, colour-by toggle and stat card
    all read "Speed", on foot and in water they read "Pace" (`metricLabel`).
  - **The swim path is unit-tested only.** None of the owner's 24 pool swims carries a
    per-sample speed or distance stream — Garmin sends lengths, not samples — so a swim
    page shows HR alone and there is no pace chart to check. The /100m axis is therefore
    proven by tests, not by a real activity. The swim's stat card, list row and map
    legend already read /100m and still do.

### T19 — MapLibre worker
- **Found in:** T01. Without `VITE_MAPBOX_TOKEN`, every map logs "Worker failed to load"
  and draws the route on a blank background.
- **Cause:** MapLibre 6 loads `maplibre-gl-worker.mjs` from next to its own chunk
  (`import.meta.url`), and Vite neither bundles nor emits that file.
- **Build:**
  - [x] import the worker with `?worker&url` and call `setWorkerUrl` in
    `MaplibreBaseMap.tsx`, in dev and in the build
- **Done when:** with no Mapbox token, the CARTO basemap draws in both themes with no console error.
- **Notes:**
  - `?worker&url`, not the plain `?url` this card guessed at: the worker file imports
    `./maplibre-gl-shared.mjs`, and `?url` emits the one file without its sibling, so the
    worker would 404 on its own import in the build. `?worker&url` bundles the two and
    returns the emitted URL.
  - The cost is that the shared half of MapLibre is downloaded twice on the no-token
    path (a 509 kB worker chunk beside the 1,072 kB map chunk, ~140 kB more gzipped).
    Vite builds workers as their own rollup pass, so they cannot share a chunk with the
    main bundle. Worth a line in T13's bundle check.

### T04 — Map: all-activities heatmap
- **Goal:** `/map` shows where you have been.
- **Backend:** type `GET /api/heatmap` (`type`, `start`, `end`, `precision`). It returns
  `points: [lat, lon, n][]`; a columnar or object shape is fine if that's cleaner.
- **Build:**
  - [x] deck.gl `HeatmapLayer` from a pure `makeHeatmapLayer(...)`, weighted by
    `log1p(n)`, with colours from `tokens.metricRamp`
  - [x] filters: type and time range
  - [x] fit the view to the data
  - [x] dark basemap in dark mode
- **Old reference:** `HeatLayer` in `map.js`, `loadHeatmap` in `app.js`.
- **Done when:** the heatmap renders for all activities and for filtered subsets, and
  panning stays smooth (note the frame rate in the commit).
- **Notes:**
  - The response is **columnar** (`lat`, `lon`, `count`), not `[lat, lon, n]` triples.
    openapi-fetch widens a tuple to `number[]` on the way through its response type, so
    the triples would have arrived in the app untyped; columnar also matches `/streams`
    and drops ~10% of the payload. The transpose is `_columnar_heatmap` in `server.py`,
    at the response boundary; `analytics/routes.heatmap` is unchanged.
  - Filters live in the URL (`/map?type=running&start=…`), defaulting to **all time**,
    not the store's 30-day range: the view is about where you have been, not this month.
  - `BaseMap` grew an optional `fitBounds`, because a filter can send the data to
    another city and the opening `initialBounds` is read once. The activity map does not
    pass it, so nothing there moves.
  - The frame rate could not be measured on this box: a drag costs ~233 ms/frame under
    headless SwiftShader whether the map carries the 10,853-cell heatmap, one route, or
    nothing at all — that is the basemap on a software rasteriser, not the layer. T13
    owns the real measurement, on a GPU.

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
  - [x] route list: name, attempts, distance, best and median time
  - [x] reachable from the Map view and from an activity's route link
- **Old reference:** `renderRoutes` in `app.js`.
- **Notes:**
  - `/api/activities/{id}/track` was **dropped**: `/streams` carries the same samples
    columnar, the route assignment is already on the activity detail, and the map works
    out its own bounds. `analytics/routes.activity_track` stays — T07's compare uses it.
  - The route polyline and each segment's path are **columnar** (`lat`, `lon`, …), for
    the reason T04's heatmap is. `signature`, the clusterer's match key, is not serialised.
  - `median_moving_time_s` is new on `/api/routes`, taken at the response boundary
    (`_route_median_times`): SQLite has no median aggregate, and `list_routes` belongs to
    `analytics/`. It agrees with `/api/routes/{id}`'s `stats.median_time_s`, which is
    computed a different way — a test pins that.
  - `PATCH /api/routes/{id}` with no `name` is now a **422**, not the 400 it was: the
    body is a model. An empty or blank name is still a 400.
  - The list's rows do not link anywhere yet; `/routes/:id` is T05b's. The Map view and
    an activity's route chip both link to the list.
  - 49 of the owner's 67 routes have one or two attempts — not loops, just activities
    the clusterer had nothing to pair with. The list is busiest-first so they sit at the
    bottom, but a "repeated only" filter may be worth it. Left for the owner to judge.

### T05b — Routes: detail
- **Build:**
  - [x] `/routes/:id`: the route map coloured by the segments' relative speed ("where
    you speed up or slow down")
  - [x] attempts table, best/median time, improvement
- **Old reference:** `openRoute` in `app.js`.
- **Done when:** a real route shows its segments and attempts.
- **Notes:**
  - A segment's colour is its `relative_speed` on the blue magnitude ramp; the legend
    reads it as a percentage against your own average on that route (`formatRelative`).
    Hovering a stretch gives its distance, pace, that percentage and its HR.
  - "Improvement" is labelled **First to last**, because that is what the backend's
    `improvement_s` is: two single attempts, not a trend.
  - The route's own polyline is drawn faintly under the segments. The stored polyline is
    100 points however long the route is, so on a long route (500 m or 1 km segments)
    some stretches hold fewer than two points and cannot be drawn; without the outline
    the route looked like it had holes in it. Fixing the cause means resampling in
    `analytics/routes.py`, which is the owner's call — see Checkpoint B.
  - `MetricLegend` and the heatmap's `DensityLegend` now share `map/RampLegend.tsx`.
  - deck.gl picks within `PICKING_RADIUS_PX` (5) of a layer. A 6 px path you had to land
    on exactly made the hover detail unusable; the activity map gets this too.

### T05c — Routes: rename, merge, split
- **Build:**
  - [x] rename, merge and split as shadcn dialogs (the old UI used `window.prompt` and
    never had a split button)
  - [x] invalidate the routes queries
- **Done when:** each works on the real-data copy.
- **Notes:**
  - Merge offers only routes of the same activity type, which is the split the clusterer
    already keeps; split refuses to empty a route and says so before the request, because
    the server answers that with a 400.
  - Delete is deliberately not built: T05c asks for rename, merge and split, and
    `DELETE /api/routes/{id}` is typed and tested without a button of its own yet.
  - Every one of the three invalidates the route list, **every** route detail and
    segment profile, and the activity list: a merge deletes routes and a split makes
    one, so no route's cached page survives either.

### T06 — Route playback
- **Goal:** replay an activity on its map (the one allowed decorative animation).
- **Build:**
  - [x] deck.gl `TripsLayer` from a pure `makeTripsLayer(activity, ...)`, using
    `elapsedS` as timestamps
  - [x] play/pause and a scrubber
  - [x] the scrub position writes `hover` in the store, so the charts' crosshair follows
- **Done when:** playback runs smoothly on the longest GPS activity and syncs with the
  charts.
- **Notes:**
  - The clock is the activity's own `elapsed_s`, so the trail, the scrubber and the
    crosshair need no conversion between them. Playback stops at the end rather than
    looping, and pressing play there starts again.
  - `makeTripsLayer` takes `trips: readonly Trip[]`, an array of one, because deck.gl
    decides whether to re-upload the path by comparing `data` **by identity**. Building
    `[trip]` inside the builder re-sent all 16,900 coordinates on every frame; hoisting
    it roughly doubled the replay's frame rate here.
  - The scrubber pauses playback: scrubbing and playing fight over the same clock.
  - Playback owns the shared `hover` while it is running, so moving the pointer off the
    route does not wipe the cursor mid-replay.
  - **Smoothness could not be proven on this box.** Under headless SwiftShader the
    longest GPS run (16.9 km, 2:17:56, ~16,900 points) replays at ~2 fps, against ~4 fps
    for plain panning on the same map — the software rasteriser, not the layer, but that
    is a floor, not a measurement. T13 owns the real number, on a GPU.

### T07 — Races and Compare
- **Races (D3):** Garmin tagged only 1 of ~487 activities as a race
  (`eventType.typeKey == "race"` in the raw payload), so races have to be marked by the owner.
  - [x] a user-only editable field `race` (bool) in `db/fields.py`, like notes and RPE.
    When it isn't set, it falls back to the raw `eventType` at the response boundary.
  - [x] a "Race" toggle in the Edit dialog, and a "Races" filter on the activity list
- **Compare:**
  - Backend: type `GET /api/routes/compare/tracks` and make its tracks columnar.
  - [x] select 2–5 activities in the list (`selectedActivityIds` in the store)
  - [x] `/compare` overlays their tracks, one colour each
  - [x] pace and HR charts on a shared distance axis; hover syncs across all of them
  - [x] "compare races at this distance" from a race's page
- **Colours:** more than 3 series needs a validated categorical palette. Check it against
  `tokens.ts` and the palette validator before adding colours.
- **Notes:**
  - The Edit dialog's Race toggle is generated from `/api/fields`, as the registry
    promises: adding the field to `db/fields.py` was the whole UI change.
  - `race` is resolved in `api/gym.py` (`RACE_SQL`), shared by the row query and the
    list's `race` filter so the two cannot disagree. The view's own `race` column stays
    the raw override; the resolved one is selected under another name because
    `sqlite3.Row` returns the **first** of two same-named columns.
  - Switching the Races filter on also drops the date bounds. Races are rare, so
    "races in the default last 30 days" is empty and reads as a broken filter.
  - Compare's tracks are columnar and named exactly as `/streams` names them, so a
    compared activity goes through the single-activity adapter and arrives with the same
    smoothed pace it has on its own page. `activity_type` is added at the boundary: the
    view needs the sport to know whether a pace reads in /km or km/h.
  - Every compared activity is **interpolated onto one grid of 600 x values**
    (`compareChart/resample.ts`). Without it the series sat on their own x values, and
    ECharts' axis tooltip named one activity out of four at the crosshair.
  - **The five series colours are new** (`tokens.series`), and `design/palette.test.ts`
    is the validator the token comments refer to: it simulates protanopia, deuteranopia
    and tritanopia (Machado 2009) and measures CIE76 distance. Five colours cannot hold
    the three kind colours' margin — that is the geometry of colour-blind vision — so
    the kinds are asserted above 25 and the series above 18, and the series always carry
    the table as a legend.
  - Adding `race` to the registry changes the `v_activities` fingerprint, so the owner's
    running container rebuilds the view when it next starts. Nothing to do by hand.

### T08 — Health
- **Backend:** type `GET /api/trends` and `/api/daily`; `/api/readiness/history` is typed.
- **Build:**
  - [x] sleep stages (stacked bars: deep, REM, light)
  - [x] sleep score, HRV and resting HR, each with its 28-day rolling baseline
  - [x] Body Battery high/low
  - [x] baseline flags as stat-card deltas
  - [x] readiness over 90 days
  - [x] one metric per chart, and a shared time-range control
- **Old reference:** `renderRecovery` in `app.js`. It drew the stacked bars as three
  overlapping series; use real stacking.
- **Notes:**
  - **You have no HRV at all, and six sleep scores.** All 1,402 raw `hrv` payloads are
    `{}` and every `sleepScores` in the raw sleep payloads is `null`, so `hrv_daily` is
    empty and `sleep.sleep_score` has six rows, all from Oct–Nov 2023. Both charts are
    therefore built and unit-tested but have never drawn on your data; the page names
    them under "Not recorded in this range" rather than showing two empty frames. This
    is your watch, not the ingest: nothing was dropped on the way in.
  - **Light sleep is served, not inferred.** `v_daily` carries deep and REM but not
    light, and the old UI reconstructed it as `total - deep - rem`. `/api/daily` now
    joins `sleep` at the response boundary and returns `light_s` as stored
    (`DailySleepRow`). The three stages sum to `total_sleep_s` on all 703 of your
    nights, so the old arithmetic was right — but it was arithmetic, and now it is not.
  - The window (90 days / 6 months / 1 year / 2 years) lives in the URL, as the map's
    filters do, not in the store's `timeRange`: it is one number of days, which is what
    all three endpoints take, and it belongs to this page rather than across views.
  - Sleep stages take three steps of the one magnitude ramp, deep at the strong end —
    they are ordinal, like HR zones, not three categories. Every other chart here tells
    its two lines apart by weight and an end label, as the fitness curve does.
  - **A metric's card takes a colour only when the backend flagged it** (|z| ≥ 1.5).
    Inside that, the difference from baseline is shown in plain grey: colouring a
    normal day reads as news when there is none. Nothing of yours is flagged today, so
    the good/bad tones are proven by test and not by a screenshot.
  - The 28-day baseline line now breaks where the daily line does. A trailing 28-day
    mean goes null only after 28 blank days, so joining across it would draw a baseline
    for a month the watch was off. Your longest resting-HR gap is 26 days, so this
    changes nothing you can see today.
  - **Readiness holds a flat line through a month with nothing behind it.** From
    2026-07-22 to 2026-08-15 `/api/readiness/history` returns ~84 "prime" every day,
    because sleep, HRV and resting HR are all missing and the score falls back to form
    alone, which decays smoothly when you are not training. The chart draws what the
    endpoint says. Whether a readiness score built on one component should be returned
    at all is `analytics/readiness.py`'s to answer, and yours to ask for.
  - At 2 years the sleep chart is 730 bars in ~1,060 px and reads as texture. It still
    shows where the gaps are, and the control is explicit about what was asked for, so
    it was left alone; the old UI capped that chart at 120 nights regardless of the
    range, which lies about the window instead.

### T09 — Trends: performance
- **Backend:** type `GET /api/performance`. Drop the preformatted `time`/`pace` strings.
- **Build:**
  - [x] personal bests table
  - [x] aerobic decoupling as a scatter plus a rolling mean, with the 5% line as a `markLine`
  - [x] efficiency factor trend
  - [x] VO2max trend
- **Old reference:** `renderPerformance`.
- **Notes:**
  - **Your 1 k and 1 mile records are one treadmill run and should probably not count.**
    Both come from 2023-02-02 (`/activities/10430340737`), 1.7 km indoors, and read
    4:34/km and 4:43/km. Your fastest kilometre outdoors is 5:55, and your 5 k best is
    7:15/km — a 1 k at 4:34 projects a 5 k around 26 minutes, not 36:16. Treadmill
    distance is the watch's own estimate, not GPS, and you have only five treadmill
    runs for it to calibrate against. Nothing was filtered: `BEST_EFFORT_TYPES` lists
    `treadmill_running` on purpose and changing `analytics/` to suit a view is not this
    task's to do. Dropping it is one word in that tuple if you want it gone.
  - The type filter is provably earning its keep. The four fastest 1 k efforts in your
    database are all **cycling** — the quickest is 1:51 — and none of them reaches the
    table.
  - There is no half-marathon or marathon row because no single activity has ever
    covered 21.1 km. Distances never covered are left out rather than shown empty.
  - **Sessions are dots, never a joined line.** Your long runs are weeks apart, so a
    line between consecutive ones would draw a slope across a gap you did not run. The
    dots are the sessions and a 10-session centred mean (`centredMean` in `lib/`) is the
    trend. VO2max is the exception and is drawn as a line: it is a daily value Garmin
    holds between runs, not a per-session one.
  - **Only 18 % of your long runs come in under Friel's 5 %** (26 of 143); the median is
    +12.5 %. The threshold line sits below most of the cloud, which is the honest
    picture, not a scaling mistake.
  - The two session charts use a **time** x-axis, not the category axis the load charts
    use: the runs are irregularly spaced and a category axis would draw 2023 and 2026 at
    the same density.
  - `decoupling_recent` (the last twelve) stays in the response although the app slices
    `decoupling` itself; it was already public and costs twelve rows.
  - `distance_km` on a decoupling row keeps its `_km` name rather than becoming `_m`.
    It is what `analytics.performance` computes, the name carries the unit, and
    reshaping `analytics/` output at the boundary for tidiness is churn.
  - `ScatterChart` and `MarkLineComponent` are now registered in `charts/echarts.ts`.
    T13's bundle check should note the scatter; the markLine is a few kB.

### T10a — Trends: totals and year over year
- **Backend:**
  - Type `GET /api/aggregate`, `/api/aggregate/filters`, `/api/aggregate/periods` and
    `/api/reports`.
  - Keep base units; the convenience `*_km` and `*_h` fields can be left out.
- **Build:**
  - [x] totals as stat cards
  - [x] year over year with deltas
  - [x] distance by month
- **Old reference:** `renderAggregate`. Don't copy its bugs: its tooltips showed NaN, and
  it put dates on non-time axes.
- **Notes:**
  - **The whole of `/api/aggregate` is typed, not just T10a's third of it.** A response
    model drops what it does not declare, so declaring only `totals`, `by_month` and
    `year_over_year` would have quietly deleted the data T10b and T10c are for.
    `distributions`, `patterns`, `streaks` and `records` are therefore modelled too, and
    those two tasks now have nothing left to type.
  - **Only the rendered strings were dropped**, not the `*_km` and `*_h` convenience
    fields this card offered to leave out: `year_over_year` keys its `changes` on
    `distance_km`, `moving_time_h` and `avg_distance_km` by those exact names, so
    dropping them would leave a delta with no number beside it. Gone are `avg_pace`
    ("17:35/km"), a best effort's `time` and `pace`, an extreme's `display`, and a
    histogram bucket's `label` — each is a number that is still in the same object.
  - **There is no pace column in the year-over-year table, although the old UI had
    one.** `avg_pace_s_per_km` is total distance over total moving time across every
    sport in the year, so a year with more gym and walking reads as a year that got
    slower: yours goes 14:29 (2023) → 11:57 (2024) → **30:30** (2025) → 8:13 (2026),
    which is a change in what you logged, not in your running. The column is Time and
    its delta instead. A pace per year becomes a real number once a sport is chosen,
    which is T10c's filter.
  - The same caveat is why the "Average pace" stat card reads `17:35 /km · mixed
    sports`. It is the number `analytics/aggregate` was written to produce and it is
    shown, but it is not allowed to look like a running pace.
  - **2023 shows ▲ 14,153% against 2022.** 2022 is one 2.6 km activity on December 27,
    so the arithmetic is right and the row below it says why. Left as it is rather than
    capped: a cap would hide that the first year is a stub.
  - Distance by month puts the empty months back (`toMonthPoints`) so the bars stay a
    month wide and a month off reads as a gap, rather than the next month sliding over
    to fill it — the same reason T09's session charts use a time axis.
  - `/api/aggregate` is 51 ms uncached, `/api/reports` 116 ms, both behind the 30 s
    mtime cache. T13 owns the real numbers.

### T10b — Trends: distributions and patterns
- **Backend:** nothing to do. T10a typed all of `/api/aggregate`; the data is in
  `aggregate.distributions` and `aggregate.patterns` (`useAggregate`).
- **Build:**
  - [x] pace, distance and HR-zone distributions
  - [x] day-of-week × hour pattern
- **Note:** a bucket carries `lo`, `hi` and `count` and no label, so the axis formats
  `lo` itself: seconds per km for pace, km for distance, minutes for duration, bpm for HR.
- **Notes:**
  - **Every chart here says how much of your history it actually covers.** Pace is 262
    of 488 activities, distance 293 of 488, average HR 483 of 488 — a gym session has no
    pace and no distance, so it is in `sample_size` and in no bar. Without the count the
    shape looks like the whole history.
  - **Garmin sent HR zones for ten of your 488 activities.** There are 6:33:39 in zones
    against 409 hours of training, and the caption says exactly that (`6:33:39 of
    409 h`) so the bar cannot pass itself off as four years of intensity. The payload
    has no count of which activities carry zones, and the two times are both already
    there, so no new field was needed.
  - **The duration distribution is not drawn**, although the endpoint sends it. Two pool
    swims carry 61 h and 47 h of moving time (`/activities` on 2025-10-20 and
    2025-11-03: a watch left running), which is 18 h more than every other activity put
    together and flattens all 18 buckets into one. Those two also inflate the "Moving
    time" total on this page by about 108 of its 409 hours. Nothing was filtered —
    excluding an activity from statistics is your call, and the tick box for it is on
    the activity page.
  - The week grid is 168 divs, not an ECharts heatmap: it needs no canvas, and
    registering the heatmap series and its visual map would put both in the bundle for
    one block. Hand-drawn for the same reason T16's body diagram is. Each cell carries
    its own count in a `title`, and intensity is scaled against the busiest slot, which
    is the only useful "full".
  - Your week reads clearly: 17:00–21:00 most days, a second lighter band at 05:00–08:00,
    and Monday and Tuesday at 20:00 the darkest cells on the grid.

### T10c — Trends: streaks, records, filters
- **Backend:** nothing to do. `aggregate.streaks` and `aggregate.records` are typed, as
  are `/api/aggregate/filters` (the type, gear and date-range options) and
  `/api/aggregate/periods`.
- **Build:**
  - [x] streaks and records
  - [x] filters (type, gear, dates) that apply to every Trends block
- **Notes:**
  - An extreme carries `key` and `raw`, not a rendered `display`; `key` is a typed
    literal of six, so the formatter switches on it (metres, seconds, metres of climb,
    m/s, bpm, TRIMP). "Fastest average pace" reads in its own sport's unit, so an
    unfiltered wall shows `19.3 km/h · Al Daayen Cycling`.
  - **"Every Trends block" stops at the performance block, and it says so.**
    `/api/performance` takes no parameters, and giving it any means teaching
    `analytics/performance` to filter, which is not a view's decision. With a filter on,
    that section is headed `Running performance · all running, not filtered`.
  - **The filter is what T10a's two deferred numbers were waiting for.** Choose a type
    and the "mixed sports" caveat leaves the Average pace card, and a Pace column
    appears in the year table. Filtered to running your years read 8:51 → 8:12 → 8:25 →
    8:54 /km, which is a pace; unfiltered the same column reads 14:29 → 11:57 → 30:30 →
    8:13, which is the sport mix. The column appears with the filter rather than
    carrying a caveat, because a table cell has nowhere to put one.
  - **You own no gear**, so `/api/aggregate/filters` returns an empty list and the gear
    select is not rendered — an empty dropdown is a control that does nothing. T12 is
    where gear gets created; the filter will appear on its own once it exists.
  - The records wall shows the two bad pool swims plainly: "Longest duration 61:18:21"
    and "Hardest session (TRIMP) 1,543" are both `Pool Swim · Oct 20, 2025`. That is the
    honest top of the list until you exclude them from statistics.
  - Editing an activity now invalidates the aggregate **and** performance queries. A
    retype or an exclude-from-stats moves every number on this page, and neither key was
    being invalidated — `performance` had been missed since T09.
  - The records table is the extremes only. The standard-distance bests are already on
    this page from `/api/performance` (now headed "Personal bests", to stop two tables
    both being called Records); `aggregate.records.best_efforts` is the same five rows
    but filterable, and drawing them twice would be worse than the small duplication in
    the payload.

### T11a — Settings: Garmin sign-in
- **Backend:** type `/api/garmin/login`, `/mfa`, `/ticket`, `/signin-url` and `/disconnect`.
- **Build:**
  - [x] password → MFA → the browser-ticket fallback that opens on a 503 (see
    `DECISIONS.md` D44)
  - [x] a connected state with a disconnect action
- **Old reference:** the Garmin flow in `app.js`.
- **Notes:**
  - `/settings` exists now, behind the corner icon the nav already pointed at. It
    holds the Garmin panel alone; T11b fills in the rest.
  - **The flow is a reducer** (`features/settings/garminSignIn.ts`), so which of the
    three routes is on screen is a value and the components that draw it hold no
    branching. Two of its rules are worth naming: a **503 opens the browser fallback
    by itself**, because Garmin refused the host rather than the credentials and
    retyping a password cannot fix that; and a **410 sends the MFA step back to the
    password step**, because an expired challenge is gone from the server's memory
    and the code field would post into nothing.
  - **A rejected Garmin password used to throw the user out of the app.** The
    client's 401 middleware treated every `/api/` 401 as "this app's session
    expired" and redirected to `/login` — but `/api/garmin/login` answers 401 when
    *Garmin* rejects an email and password, which is a different account. The
    exemption is now a named predicate, `isSessionPath`, with a test.
  - `POST /api/garmin/login` returns a **discriminated union** on `status`, so the
    generated TypeScript narrows to "connected" or "needs a code" instead of one
    object with every field optional.
  - **A body missing a key is now 422, not 400** — the same shift T05a's `PATCH
    /api/routes/{id}` made, for the same reason: the body is a typed model. An
    *empty* email, password or ticket is still a 400, because that check is the
    handler's, not the model's.
  - **The password and the MFA step could not be tried against Garmin.** Doing so
    means the owner's real credentials, and a run of failed attempts on this IP is
    what D44 exists because of. What was checked on the running stack: the
    not-connected screen, the browser-ticket panel open, the connected card and its
    confirm dialog (a placeholder token file in `api-dev`'s own throwaway volume,
    removed again), a real `POST /api/garmin/disconnect` that returned
    `removed_files: 1` and left no token file, a 410 from a made-up challenge id, a
    400 from a blank ticket, and the sign-in URL. The two transitions that need
    Garmin — the MFA hand-off and the 503 — are proven by the reducer's tests.

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

### T20 — Prove the one-command install
- **Found in:** T03c. The production image has not been rebuilt since the React
  frontend landed, so `docker compose up -d` serving the built SPA is untested. Only
  `api-dev` and `ui-dev` have run since F4.
- **Build:**
  - [ ] `docker compose build app`, then `docker compose up -d`, and open the app on
    its own port: nav, an activity page and the Edit dialog, in both themes
  - [ ] check the image carries `garmin_analytics/ui/` (the Docker build runs
    `npm ci && npm run build`), and that the SPA fallback serves a deep link
  - [ ] fix what the check finds, or add a row for it if it is not a small fix
- **Careful:** the owner's data is in that container. Don't recreate its volume, and
  ask before stopping it.
- **Done when:** a fresh `docker compose up -d` serves the React app.

### T14 — Cleanup and frontend README
- [ ] `frontend/README.md`: how to run (dev, build, Docker), the folder structure, and
  "how to add a chart" and "how to add a map layer", each with a short example
- [ ] remove leftovers: dead components, unused tokens, TODOs
- [ ] update the note at the top of the root `README.md`
