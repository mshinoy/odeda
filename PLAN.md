# Build plan

Started as the frontend rebuild (Phases 0–4) and kept going: Phase 5 added a second data
source, Phase 6 made the app sync itself, Phase 8 reads the owner's training plan. Most
phases now touch `garmin_analytics/` as much as `frontend/`.

This file is the plan **and** the tracker. The status tables below are the only place
progress is recorded: agents pick tasks from them and update them in the same commit as
the work, and the owner reads them to see what is done. `git log -p PLAN.md` is the
history.

**One branch per phase or task**, named for the work (`auto-sync`, `activity-cards`,
`training-plan`), merged to `master` when its checkpoint is approved. There is no
long-lived `frontend-rebuild` branch any more.

Phases run in parallel, so **never work in a directory another agent is using**: the
branch under you can change mid-task. Take a worktree of your own —
`git worktree add ~/garmin-<task> -b <task>` — and stay in it. Commit a `PLAN.md` edit
on its own, so two phases touching the file merge cleanly.

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
| 4 Settings & finish | D: `ready for review` | 7 / 7 |
| 5 Fitbit body composition | E: `ready for review` | 8 / 8 |
| 6 Automatic sync | F: `ready for review` | 3 / 3 |
| 7 Activity cards | G: `ready for review` | 1 / 1 |
| 8 Training plan | H: `ready for review` | 10 / 10 |
| 9 Speed | I: `ready for review` | 1 / 1 |
| 10 Routes that know laps | J: `ready for review` | 1 / 1 |
| 11 Loose ends | K: `ready for review` | 3 / 3 |

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

### Phase 4 — Settings & finish · Checkpoint D: `ready for review`

| ID | Task | Status | Depends on | Commit |
|---|---|---|---|---|
| T11a | Settings: Garmin sign-in (password → MFA → ticket fallback) | done | — | Settings: connect a Garmin account, by password, by code or through a browser |
| T11b | Settings: sync, overrides summary, version, theme toggle | done | — | Settings: what a sync would cost, what you have edited, and a theme you pick |
| T12 | Gear: mileage, wear, CRUD, bulk reassign, defaults | done | T11b | Gear: what you run in, how far it has gone, and switching it after the fact |
| T13 | Performance check: largest activity, heatmap, bundle size | done | T04, T10c | Performance: the build was never compressed, and what a hover really costs |
| T20 | Prove the one-command install on the current image | done | — | Prove the one-command install: build the image, run it clean, restart it |
| T21 | Activity list: an "edited" filter, so Settings can link to it | done | — | Activity list: an Edited filter, and the Settings link that wanted it |
| T14 | Cleanup and frontend README | done | every other task | A README for the frontend, and the leftovers of a rebuild that is over |

### Phase 5 — Fitbit body composition · Checkpoint E: `ready for review`

A second data source. The Aria scale writes to Fitbit, not Garmin, so weight has never
reached this app — `body_composition` exists, is joined into `v_daily`, and holds zero
rows. This phase fills it and makes it mean something against the training data.

| ID | Task | Status | Depends on | Commit |
|---|---|---|---|---|
| T22 | Seeder: a weigh-in series worth smoothing (gaps, drift, hydration noise) | done | — | Seeder: a weigh-in series worth smoothing |
| T23 | Fitbit OAuth: authorize → code → token → refresh, cached on the volume | done | — | Fitbit OAuth, proved without a Fitbit account |
| T24 | Fitbit ingest: weigh-ins by date range, raw-first, resumable, rate-limit paced | done | T23 | Fitbit ingest: three years of weigh-ins in 36 requests |
| T25 | Fitbit export importer (Google Takeout), no credentials needed | done | — | The Fitbit export: a decade of weigh-ins with no credential |
| T26 | Body analytics and `/api/body`: trend, fat/lean, consistency, projection | done | T22 | Body composition: the trend, not the morning |
| T27 | Health: the body-composition section | done | T26 | Health: what the scale says, once the noise is out of it |
| T28 | Trends: weight against training load, and pace per kg | done | T26 | Trends: bodyweight against the training that moved it |
| T29 | Settings: connect Fitbit, import an export, sync body composition | done | T24, T25 | Settings: connect the scale, or import it from a ZIP |

### Phase 6 — Automatic sync · Checkpoint F: `ready for review`

Both sources are pull-only and only pulled when the owner presses a button, so the
data is as old as the last time anyone remembered: on 2026-10-08 the newest Garmin day
was eleven days behind. This phase makes the app keep itself current.

| ID | Task | Status | Depends on | Commit |
|---|---|---|---|---|
| T30 | Auto-sync: Garmin and Google Health every 6 hours, in the server process | done | — | Auto-sync: the data stops being as old as the last button press |
| T31 | Settings: say that it syncs on its own, when it last did, and what went wrong | done | T30 | Settings: it syncs on its own now, and says so |
| T32 | Google sign-in: show when it expires, warn before, reconnect in one step | done | T31 | Google's weekly sign-out, said before it happens and renewed in one step |

### Phase 7 — Activity cards · Checkpoint G: `ready for review`

The activity list is a table: date, name and five numbers. The owner asked for
landscape cards, each with a map beside it and the stats its type is about, the way
Strava shows a feed but laid out for a wide screen.

| ID | Task | Status | Depends on | Commit |
|---|---|---|---|---|
| T33 | Activities: cards with a static map, a body diagram or HR zones beside each; table kept behind a toggle | done | — | Activities: a card per activity, with its route, muscles or zones beside it |

### Phase 8 — Training plan · Checkpoint H: `ready for review`

The app knows what the owner **did** and what they are training **for**, and nothing
about what they were **supposed to do**. `config.RACE_*` holds the race; `TARGET_PEAK_CTL
= 75` and `TARGET_PEAK_WEEKLY_KM = 55` are numbers an agent invented, not the plan's.
The plan itself lives in a Google Calendar the owner keeps by hand — Hal Higdon Novice 1
remapped to the Qatar week, with the Friday long runs set deliberately above it.

This phase reads that calendar, matches each prescribed session to the activity that
fulfilled it, and answers three questions the app cannot answer today: **did I do it**,
**am I still on the curve**, and **does the curve reach 15 January**.

| ID | Task | Status | Depends on | Commit |
|---|---|---|---|---|
| T34 | Schema v3: `plan_sources`, `plan_sessions`, `plan_links`, and the migration | done | — | Schema v3: somewhere to put what was prescribed |
| T35 | `ingest/plan_ics.py`: fetch a private ICS feed, expand recurrence, withdraw what vanishes | done | T34 | The calendar, read without trusting it |
| T36 | `plan/parse.py`: prose → a prescription, with `GA:` hint lines winning | done | T34 | What the week actually asks for |
| T37 | `analytics/plan.py`: match planned sessions to activities, and score adherence | done | T35, T36 | Whether the training happened |
| T38 | `/api/plan`: the plan, the week, a manual re-link, and a sync | done | T37 | The plan, over HTTP |
| T39 | Auto-sync: the plan as a third source beside Garmin and Google Health | done | T35 | The calendar keeps itself current |
| T40 | Status: this week against the plan, and the planned line on the race panel | done | T38 | This week against the plan, and the plan against the race |
| T41 | Settings: the feed, what it parsed, and what it could not | done | T38 | The calendar, and what it could not read |
| T42 | Targets come from the plan; the invented constants go | done | T37 | Targets the plan actually asks for |
| T48 | An ignored session is actually ignored | done | T37 | A decision nobody read |

### Phase 9 — Speed · Checkpoint I: `ready for review`

The owner asked why the Map page is slow (2026-10-08). Measured: the heatmap is
recomputed (~1–1.5 s) on most visits because the analytics cache expires after 30 s,
and the map library only starts downloading once the heatmap has arrived.

| ID | Task | Status | Depends on | Commit |
|---|---|---|---|---|
| T43 | Map: cache until the data changes, warm it after a sync, open the map before the heatmap arrives | done | — | The Map opens without waiting for the heatmap, which is ready before it is asked for |

### Phase 10 — Routes that know laps · Checkpoint J: `ready for review`

70 routes for 265 GPS activities (2026-10-08): two laps of a loop can never join one,
because routes are matched on total distance within 25%, and a route's shape is
whichever run created it. The owner's loops (Bin Omran, ~1.6 km; another at
25.345, 51.522, ~1.4 km) are run 2–9 times a session; the QSC out-and-backs turn at
different points.

| ID | Task | Status | Depends on | Commit |
|---|---|---|---|---|
| T44 | Routes: group by ground covered (laps and a short warm-up join, a much longer out-and-back does not), one lap as the shape, lap times and best lap for loops | done | — | Routes know laps: a loop is one route however many times round, with its fastest lap |

### Phase 11 — Loose ends · Checkpoint K: `ready for review`

What T43 and T44 left (2026-10-08): the Map opens on every country with a GPS point,
about one lap in six round a loop goes untimed, and the regroup renumbered every route.

| ID | Task | Status | Depends on | Commit |
|---|---|---|---|---|
| T45 | Map: open on where most of the activity is, not on every point ever recorded | done | — | The Map opens on home, not on every country there is a point in |
| T46 | Laps: timed from where each run started on the loop; cut corners do not count | done | — | Laps are timed from where the run began, and a cut corner is not a lap |
| T47 | Routes keep their numbers: a regroup reuses them, and today's renumbering is undone | done | — | Routes keep their numbers through a regroup |

### Open decisions

When an agent needs the owner, it adds a row here (`D4`, `D5`, …) and sets its task to
`needs decision: <question>`.

| ID | Question | Status |
|---|---|---|

### Decided

| ID | Decision | Date |
|---|---|---|
| D1 | The current design (tokens, activity page, Status page) is the starting point, not a freeze. The owner will keep adjusting it at checkpoints. T01 applies the three tweaks: ~30 s pace smoothing, "/km" once on the axis, and checking the map background on real routes. | 2026-09-24 |
| D2 | Login stays off (`APP_PASSWORD` unset). There is no task to re-enable it. Keep the Login page code. | 2026-09-24 |
| D3 | "Events" in the brief means **races**. Gym sessions must also be shown properly: exercises, sets, reps and the muscles trained (T15–T17). | 2026-09-24 |
| D4 | `body_composition` keeps its shape. Every Fitbit field has a home in it (`weight_kg`, `body_fat_pct`, `bmi`); the ones that do not — time of day, the device name, the log id — are already kept verbatim in `raw_documents`, which is where provenance belongs. No migration. | 2026-09-26 |
| D5 | A day with several weigh-ins keeps the **earliest** one. The table is keyed by day and a morning reading before food and water is the comparable one; taking the last reading would mix a 07:00 measurement with a 21:00 one and call the difference a trend. The whole day's readings stay in `raw_documents`. | 2026-09-26 |
| D6 | Body composition gets no nav item — the nav stays at five (Rules). The trend, the fat/lean split, weigh-in consistency and the race-day projection go on **Health**, next to the other daily measurements; weight against training load and pace per kg go on **Trends**, next to the performance work they qualify. | 2026-09-26 |
| D7 | The Fitbit client uses **stdlib `urllib.request`** behind a one-method transport, not a new HTTP library. It is four calls against a documented JSON API, and an injectable transport is what makes the whole OAuth flow testable without an account (T23). No new Python or npm dependency in this phase. | 2026-09-26 |
| D8 | Sync runs on its own **every 6 hours**, inside the `app` server process, with `GA_AUTO_SYNC_HOURS` to change it and `0` to turn it off. Four light runs a day keep the data fresh by morning and evening without leaning on Garmin's unofficial API; a manual sync still works whenever wanted. | 2026-10-08 |
| D9 | The Google Cloud app **stays in Testing**. Leaving it needs a public homepage and privacy-policy URL on a domain the owner controls, which a one-person app does not have. The price is that Google ends the sign-in 7 days after each consent, so it is renewed weekly from Settings, and Settings says when it is due (T32). | 2026-10-08 |
| D14 | The activity list shows **cards by default**, each with a **Mapbox static image** of the route (one `<img>`, not a live map), a body diagram for gym sessions, HR zones or the sport's icon otherwise; the table stays behind a Cards/Table toggle (T33, DECISIONS D50). | 2026-10-08 |
| D15 | Analytics are cached **until the data changes**, not for 30 s: the version is the database's mtime plus the WAL's size and mtime (an empty WAL ignored), and the unfiltered heatmap is recomputed in the background once a change settles (`GA_CACHE_WARM=0` turns that off). DECISIONS D51. | 2026-10-08 |
| D16 | Routes are matched on **ground covered**, not distance: a run joins a route when at least **75%** of the distance run was on the route's ground and it covered at least 75% of the route (the owner's "about 25%"). Laps and a short warm-up join; an out-and-back that goes much further does not. A route's shape is one lap; loops are timed by the lap. DECISIONS D52. | 2026-10-08 |
| D10 | **The ICS feed is parsed by a stdlib subset parser.** `FREQ=WEEKLY` and `FREQ=DAILY` with `INTERVAL`, `BYDAY`, `COUNT`, `UNTIL`, `EXDATE` and `RECURRENCE-ID`; anything else is refused as `unsupported_rrule` and stored once at DTSTART rather than expanded on a guess. No new dependency, consistent with D7. The owner chose this over `icalendar` + `python-dateutil`. | 2026-10-08 |
| D12 | **The race panel's targets are derived from the plan, and the constants are removed.** `TARGET_PEAK_CTL = 75` and `TARGET_PEAK_WEEKLY_KM = 55` were invented by an agent, and the owner's plan peaks at **35.7 km/week** — so the panel was warning "a long way short" on weeks he was following exactly. Weekly km comes straight from the plan; the CTL target is computed from his own recent pace and labelled as derived. With no calendar connected the targets are `None` and the panel shows the curves without a goal line rather than inventing one. T42. | 2026-10-08 |
| D13 | **Where a day's events disagree, the more specific event wins.** A dated one-off beats an instance of a recurring series, so 12 Jan's `W12: Run 3.2 km` beats the club series' standing 8-10 km and the taper is respected. This reverses what was said earlier about the Monday week note always winning. The rule lives behind one function so it can be changed once real weeks have been scored. | 2026-10-08 |
| D11 | **The plan gets both: a `/plan` tab in the nav, and a "This week" strip on Status.** The five-item rule was written before the plan existed and is amended in Rules. The owner's framing is that **Status is a home dashboard**, not a peer page — it carries a summary from whichever tabs matter, and is meant to become configurable — so a strip on Status does not make the tab redundant. The strip answers "what today, am I on it"; the tab holds the twelve-week grid. | 2026-10-08 |

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
   `~/garmin-review/<letter>/` — the phase's own checkpoint letter, now through H.
   That folder is outside the repo; never commit screenshots.
3. Sets the checkpoint to `ready for review` in the phase table and the summary table,
   and commits `PLAN.md`.
4. Pushes the phase's branch: `git push origin <branch>`. If there is no `origin` remote,
   it says so
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

Seven tasks: Settings, Gear, the performance check, and proving the install. The last
phase, so this is also the end of the rebuild.

| | |
|---|---|
| `cc812ec` | Settings: connect a Garmin account, by password, by code or through a browser |
| `4e99e15` | Settings: what a sync would cost, what you have edited, and a theme you pick |
| `7883004` | Gear: what you run in, how far it has gone, and switching it after the fact |
| `0a3be19` | Performance: the build was never compressed, and what a hover really costs |
| `40158c1` | Prove the one-command install: build the image, run it clean, restart it |
| `39d949c` | Activity list: an Edited filter, and the Settings link that wanted it |
| `c3024b9` | A README for the frontend, and the leftovers of a rebuild that is over |

**The two that matter most.**

- **`docker compose up -d` works.** The production image had not been built since the
  React frontend landed, so the README was claiming something nobody had run. It was
  built and run from a genuinely clean state — its own compose project, its own empty
  volume, its own port, so your `garmin-analytics-data` was never mounted and the dev
  pair on 5173 never stopped. An empty first run comes up healthy and draws a calm
  `/status` rather than a broken page; with `GA_SEED_DEMO=1` it serves every view with
  no console errors; the activity page, the Edit dialog, the gear selects and the
  Mapbox basemap all work from the image; a deep link falls back correctly; and a
  restart keeps an edited title, an RPE and a gear item. Nothing had to be fixed.
- **Gear is the thing you asked for first, and the Nimbus → Novablast case works.**
  On your real 488 activities: the Nimbus put on all 234 runs, then the Novablast put
  on the 2026 runs — 27 runs changed shoes, the Nimbus dropped to 207 activities and
  1,115.6 km, the Novablast rose by the same 130 km, and the Sep 22 run now reads
  Novablast on its own page. Assigning replaces gear of the same kind, so the bulk
  assign is the correction. The edit survives a re-sync: after re-normalising all 489
  activity rows from the archived payloads — the same write path a sync takes — every
  item's count and mileage was identical.

**To look at** (on http://localhost:5173):

- `/gear`, or the footprints icon in the corner. Three items, worst wear first. The
  Nimbus is over its limit in red with the reason in words. "Edit" is one dialog where
  the old UI asked seven `window.prompt`s; "Assign to a range" previews before it
  applies, and Apply stays disabled until you have seen the count.
- `/settings`, the gear icon. Garmin sign-in (password, then a code, with the browser
  route under "Sign in through a browser instead"), the sync panel with all seven
  endpoint watermarks and a 1.4 h – 3.4 h estimate, your edits, the theme toggle and
  About.
- **The theme toggle is the quickest thing to judge**: Light / Dark / System. It is
  remembered in this browser, and System still follows the OS live.
- `/activities` — there is an "Edited" toggle beside "Races" now, and Settings links
  to it.
- `/nowhere` — the catch-all used to say "Not built yet". Everything is built, so it
  says something true instead.

Screenshots, light and dark, are in `~/garmin-review/D/`.

**Two things on :5173 are mine, not yours.** The three gear items and the four edits
in those screenshots were made on `api-dev`'s throwaway copy so the features had
something to show — you own no gear, and had no edits. They disappear the moment
`api-dev` restarts, and they never touched your database.

**Unsure about:**

- **The MFA step and the 503 fallback were never tried against Garmin.** Reaching
  either means real credentials and a run of failed attempts from this host, which is
  the thing D44 exists because of. Both are proven by the reducer's tests, and
  everything that does not need Garmin was exercised for real. If you connect an
  account and the code step misbehaves, that is the untested path.
- **`GET /api/gear/{id}` is typed and tested with no page behind it.** T12 asked for
  cards, CRUD, bulk assign and defaults, and a per-item page was not on the list. The
  endpoint returns the item plus its 500 most recent activities whenever you want one.
- **A body missing a key is now a 422 rather than a 400**, on `/api/garmin/*` and
  `/api/gear*`, because those bodies are typed models — the same shift T05a made for
  `PATCH /api/routes/{id}`. Nothing in the app sends such a body. An *empty* value is
  still a 400.
- **Nothing on this box can meet the 16 ms frame budget, and T13 could not fix that.**
  A chart hover costs ~65 ms above the harness floor, and ~360 ms on a page that also
  has a map, because every pointer move repaints WebGL through a software rasteriser.
  The composition is in T13's notes. The real numbers still need a machine with a GPU;
  `frontend/scripts/measure.mjs` is committed so you can take them in one command.
- **T13 found that the app had never compressed anything.** `StaticFiles` does not
  gzip, so every browser was being sent 1.2 MB of JavaScript. It is 450 kB now. That
  was a real defect sitting in plain sight for the whole rebuild, and the only reason
  it was caught is that this row asked for a number.
- **Two of T06's notes were wrong and are corrected in T13's.** The longest GPS run is
  1,605 points, not the ~16,900 that note claims — its 16.9 km read as metres.

965 backend tests, 645 frontend tests.

Owner feedback: still unreviewed. Phase 5 was authorised on top of it on 2026-09-26
without a ruling on D, so D stays `ready for review` and nothing in Phase 5 depends on
it. The five "Unsure about" items above are still open questions for the owner.

### Checkpoint E — Fitbit body composition

Eight tasks: a second data source, from OAuth to two charts. The Aria scale writes to
Fitbit, so `body_composition` had a schema, a join into `v_daily`, and zero rows.

| | |
|---|---|
| `530c4e4` | Seeder: a weigh-in series worth smoothing |
| `e9d017a` | Fitbit OAuth, proved without a Fitbit account |
| `1624aa6` | Fitbit ingest: three years of weigh-ins in 36 requests |
| `979beb3` | The Fitbit export: a decade of weigh-ins with no credential |
| `af6ff7a` | Body composition: the trend, not the morning |
| `d89d027` | Health: what the scale says, once the noise is out of it |
| `56b7d27` | Trends: bodyweight against the training that moved it |
| `3aeef52` | Settings: connect the scale, or import it from a ZIP |

**Read `HANDOVER-FITBIT.md` first.** It is the five minutes of clicking at
dev.fitbit.com, two lines in `.env`, and one command — plus the honest list of what has
never met Fitbit's servers.

**The three that matter most.**

- **Nothing here has made a single request to Fitbit**, because the credential did not
  exist while it was written. What that bought is that the whole flow is driven through
  an injected transport over payloads written from Fitbit's documentation — the
  exchange, the refresh rotation, a surprise 401 that refreshes once and retries, a
  second 401 that stops instead of looping, a 429 that carries when to come back, and
  both error envelopes, since the auth layer is Google's now. 41 tests, none of which
  have met Fitbit. The export importer *was* run end to end against a live server with
  a ZIP built for it: 168.4 lb came back as 76.38 kg.
- **The range endpoint is the difference between a backfill that finishes and one that
  does not.** 150 requests an hour; three years day-by-day is 1,096 requests. The
  31-day range form of the weight log makes it **36**, and a test asserts that number,
  because if that form is ever withdrawn the fallback is not "slower", it is the
  Takeout import.
- **A scale reading is mostly hydration, and the whole section is built on saying so.**
  0.62 kg day to day against 0.099 kg for a 7-reading mean, measured on the seeded
  series. The trend is the line; the mornings are faint dots behind it.

**To look at** (on http://localhost:5173, once there are weigh-ins — today there are
none, and both sections correctly draw nothing):

- `/health` — six cards, the weight trend, fat against lean, and the Doha projection.
- `/trends`, at the bottom — weight through the block against CTL, run speed against
  weight, and W/kg.
- `/settings` — the Fitbit panel under the Garmin one. It says which of three states
  you are in and prints the exact redirect URL to register.

Screenshots, light and dark, are in `~/garmin-review/E/`. They are taken against
**seeded** data on a throwaway backend, because the real database has no weigh-ins
yet; `health-real-no-weight.png` is the real one, showing the section correctly absent.

**Three judgements I made rather than building to order:**

- **"Pace per kg" was rejected on merit.** Running's metabolic cost is already roughly
  proportional to bodyweight, so speed is mass-normalised to begin with and dividing it
  by mass again produces a number with no meaning. Run speed and weight are shown as
  two indices instead, leaving the comparison to the reader. W/kg for *rides* is built,
  because there it is real physiology.
- **Weight and CTL are two stacked panels, not two lines.** Kilograms and a load index
  are not the same quantity and a single axis over both either flattens the weight or
  scales one against an axis nobody can see. Twin axes are the usual answer and are not
  allowed (Rules) — for exactly that reason.
- **The pace benefit per kilogram is a rule of thumb** and says so in the field name,
  the model's docstring, and the sentence under the chart. A test asserts those words
  are still there.

**Unsure about:**

- **Whether registration at dev.fitbit.com still issues a working client secret.** The
  auth layer moved to Google; the data endpoints are unchanged but the sign-up is the
  part I could not exercise. If it fails, the Takeout import needs none of it.
- **The 31-day range form.** Fitbit's current doc page shows only the single-date form;
  the range form is long-standing, and an unauthenticated probe answers 401 before
  routing, so it proves nothing. A withdrawal shows up as a clear 400 and the fix is
  one constant and one path.
- **The `/api/fitbit/callback` route works only if the registered redirect really
  points at this app.** That is a setting at dev.fitbit.com that nothing here controls,
  which is why pasting the address bar does the same job.
- **The real shape of an Aria record.** Written from documented fields, handling the
  cases I know of. Anything unexpected is archived verbatim, so a fix is a re-parse and
  never a re-fetch.
- **Three commits' worth of chart defects were found by looking at screenshots, not by
  tests** — a fat/lean chart that was two flat parallel lines, a training-load axis
  running to −50, and a load line that was the same colour as the weight line in dark
  mode. All three now have tests. It is worth noting that the tests did not find them.

1,141 backend tests, 706 frontend tests across 59 files.

Owner feedback:

### Checkpoint H — Training plan

Ten tasks. The app now knows what you were **supposed** to do, and will say whether you
did it. Checkpoints F and G are still unreviewed above this one.

| | |
|---|---|
| `cdb488c` | Schema v3: somewhere to put what was prescribed |
| `fa27c01` | The calendar, read without trusting it |
| `3b6136a` | What the week actually asks for |
| `de1c355` | Whether the training happened |
| `e30ac24` | The plan, over HTTP |
| `9fde028` | GA_PLAN_ICS_URL, so the address can be declared instead of pasted |
| `679ce05` | The calendar keeps itself current |
| `0cf645b` | Targets the plan actually asks for |
| `b4051e3` | A decision nobody read |
| `b5479fa` | This week against the plan, and the plan against the race |
| `cec0e55` | The calendar, and what it could not read |

**Start here: nothing is connected yet, and that is the first thing to do.** Open
`/settings` → Training plan, and paste the secret iCal address (Google Calendar →
that calendar's settings → "Secret address in iCal format"). Until you do, `/plan`
says one line, the race panel draws its curves with no goal line, and that is
deliberate — see below.

**The three that matter most.**

- **Two numbers that were measuring you against nothing are gone.** `TARGET_PEAK_CTL =
  75` and `TARGET_PEAK_WEEKLY_KM = 55` were invented by an agent in Phase 0. Your plan's
  biggest week is about 35.7 km, so the race panel was warning "a long way short" on
  weeks you had followed exactly. Volume now comes straight from the calendar. The
  fitness target is that peak week priced in **your own** load per kilometre — 12.53
  TRIMP/km over your last 90 days, stable at 12.62 over 28 — which turns 35.7 km/week
  into **CTL 63.9**, against the 19.2 you are at now. With no calendar connected both
  are null and nothing is drawn. The old 55 km/week would have implied 98.5.
- **Ignoring a session did nothing at all, for the whole of this phase.** The endpoint
  accepted it, wrote the row, answered 200, and the matcher only ever read the *manual*
  links. Found while wiring the button that calls it. It works now, and it was worth the
  separate commit: `b4051e3` is the one to revert if the behaviour is wrong.
- **Adherence never appears alone.** A 16 km run at the wrong effort is `done` exactly
  like a good one, so `/plan` says the percentage and "N of the last 6 long runs held
  together to the end" in the same breath. On your real data the second sentence is the
  one with something to say.

**To look at** (on http://localhost:5173):

- `/plan` — the new tab, sixth in the nav (D11). The verdict sentence, adherence, the
  plan's peak week and the fitness it implies, then a row per week to race day. Click a
  week: every prescribed day, the activity that fulfilled it, and the controls to
  re-link or ignore. The opened week is in the URL, so `/plan?week=2026-09-21` is a
  link you can keep.
- `/status` — the race panel now draws your weekly kilometres with the plan's
  prescription as a dashed step over them, running on past the last bar to January.
  Below it, this week session by session, what is next, and four-week adherence.
- `/settings` → Training plan — the address (masked, always), when it was last read,
  Sync now, and the two lists: what the parser refused, and what you overruled by hand.

**The screenshots are of a plan that is not yours.** Your calendar's address is a
credential and is not in this repository, so `~/garmin-review/H/` was taken against your
**real activities** with a stand-in Higdon block written into the throwaway copy by
`scripts/dev-standin-plan.py`. Every verdict in them is real — Sep 21 at 69%, the
Wednesday run swapped for your Sep 23 ride, the Sep 25 long run matched — but the
prescriptions are invented, and the stand-in's peak week (44.1 km) is higher than your
real 35.7. `no-plan-status.png` and `no-plan-plan.png` are the honest ones: that is what
you will actually see until you paste the address.

**Unsure about:**

- **Nothing in this phase has met your real calendar.** The ICS parser, the prose
  parser, the matcher and the whole adherence calculation were built against written
  fixtures and are exercised here against a feed I wrote to look like yours. The first
  real sync is the test, and the parse review list in Settings is where it will tell
  you what it could not read.
- **A re-link only offers activities within a day of the session**, because that is all
  the matcher will honour (`analytics/plan._claim` looks at the session's day and the
  two either side). If the activity that really fulfilled Friday happened on Monday,
  there is no way to say so. That may want widening once you have used it.
- **The grid prints "—" for every week still to come**, because a session is
  deliberately not counted until its day is over. It is honest and it is also fifteen
  rows of nothing; a column showing what each future week asks for might be better.
- **`/api/config` lost its `targets` block.** Nothing in the app read it, but it is an
  API change.
- **The efficacy line counts long runs with usable heart rate**, and says so when there
  are none. It does not yet use `project_race_time` against a goal time, because there
  is no goal time anywhere in the app — only a race date.

1,436 backend tests, 797 frontend tests across 69 files.

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
   - Work in a worktree of your own, on a branch named for the task or phase:
     `git worktree add ~/garmin-<task> -b <task> master`. Commit the claim there.
   - If another agent has already claimed the row, their claim will conflict with yours
     when you rebase: the task is taken, so abandon the branch and pick again.
   - **Never edit files in a directory another agent is working in**, and never assume
     the branch you started on is still checked out there.
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
   - Leave the branch for the owner to merge at the checkpoint. If you do integrate,
     rebase onto `master` first; conflicts in `PLAN.md` touch only rows, so keep both
     sides. Remove the worktree when the phase is done, not between tasks.
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
  - Python has stayed at its original pins throughout (D7, D10): the Google Health
    client and the iCalendar reader are both stdlib. Where a format is large but the
    input is one known feed, read the subset and **refuse the rest loudly** rather than
    taking a dependency or guessing.

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
- Nav is Status · Plan · Activities · Map · Health · Trends. Settings and Gear sit
  behind the corner icon. **Status is the home dashboard, not a peer page** — it carries
  a summary from whichever tabs the owner cares about, and is intended to become
  configurable. So a section appearing on Status is normal and does not mean its tab is
  redundant. (Amended by D11; this read "five items" before the plan existed.)

**Safety**
- Never commit tokens, passwords, `.env` files, the database or copies of it.
- **The training calendar's iCal address is a credential.** It grants read access to the
  whole calendar with no further authentication. It lives in `plan_sources.url`, is
  masked everywhere it leaves the API (`plan_ics.mask_url`), and must never reach a log
  line or an error message — including the ones `urllib` writes for you.
- Read the live database only through SQLite's **online backup** into a copy, the way
  `scripts/dev-real-data.sh` does. Never open `/data/garmin.db` for writing.
- Don't rebuild, stop or reconfigure the owner's running container, and don't edit the
  root `.env`, without asking. Develop against a copy (below). Edits (overrides) are
  tested on the copy, never the live DB.

## Verifying a task

```bash
# Backend (whenever garmin_analytics/ changed)
.venv/bin/pytest -q                              # must be fully green

# From a worktree there is no .venv of its own. Borrow the main checkout's interpreter
# and point PYTHONPATH at your tree, or you will silently test the *other* branch:
PYTHONPATH=$PWD ~/garmin-analytics/.venv/bin/pytest -q

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
| Training plan: the calendar reader | `garmin_analytics/ingest/ics.py` (RFC 5545 subset), `ingest/plan_ics.py` (fetch, withdraw) |
| Training plan: the prose | `garmin_analytics/plan/parse.py` (`GA:` hint → Monday's week note → the title) |
| Training plan: the scoring | `garmin_analytics/analytics/plan.py` (collapse → match → weekly) |
| Training plan: the tables | `plan_sources`, `plan_sessions` (keyed `uid` + `recurrence_id`), `plan_links` |
| Editable fields, overrides | `garmin_analytics/db/fields.py`; table `overrides` keyed by (`activity_id`, `field`) |
| Raw Garmin payloads | table `raw_documents`; `activities.raw_id` → `raw_documents.id`; `GET /api/raw/{endpoint}/{ref_key}` |
| Old UI, for reference | `git show 9770081~1:garmin_analytics/web/app.js` (also `map.js`, `index.html`) |

**Typing the API.** Almost every endpoint now has a `response_model`; run
`npm run gen:api` and the types come out. The exceptions, which still answer loosely
typed JSON, are the auth routes (`/api/auth/*`), `/api/doctor`,
`/api/raw/{endpoint}/{ref_key}`, `/api/overrides/bulk`, the Fitbit OAuth callback, and
several `PUT`/`DELETE` edit routes. A task that first needs one of those types it.

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
  - [x] sync: estimate, start/stop, per-endpoint watermarks
  - [x] summary of edits (overrides, including T16b's exercise relabels)
  - [x] version, data range
  - [x] light / dark / system theme toggle (extend `design/theme.ts`)
- **Old reference:** `renderSettings` in `app.js`.
- **Notes:**
  - **The theme toggle is a preference, not a theme.** `design/theme.ts` now holds
    `light | dark | system`, resolves it against the OS, and remembers it in
    `localStorage` (`ga.theme`). `system` stays the default and still follows the OS
    live; the other two stop listening. Checked by emulating a dark OS and choosing
    Light: the page turns light and stays light.
  - **The estimate's two rendered strings were dropped**, per the response-boundary
    rule: `estimated_low` / `estimated_high` were `str(timedelta(...))`, and the
    seconds behind them are still there. They needed a formatter that is not a
    stopwatch — `formatDuration(4932)` reads "1:22:12", which claims a precision an
    estimate does not have — so `formatRoughDuration` is new in `format.ts`: "8 min",
    "1.4 h", "2.1 days". The low and the high are both shown, because the backend
    reports a range on purpose.
  - **`/api/config` is fully modelled**, including `race`, `athlete` and `targets`,
    for T10a's reason: a response model drops what it does not declare, and the About
    panel needs only `version`, but silently deleting the rest of a public endpoint is
    not this task's to do.
  - **`/api/overrides` keeps its `fields` copy of the registry.** It duplicates
    `/api/fields`, but it is what lets a field's count be labelled without a second
    request, and the panel's label lookup is one line (`editSummary.ts`).
  - Making or reverting an edit now invalidates the overrides count, from both the
    Edit dialog and an exercise relabel. Neither key existed before this task.
  - **The edits panel does not use `EmptyState`.** That component centres itself over
    a whole view, and this is one of five left-aligned panels; a centred block in the
    middle of them reads as a broken page.
  - **There is no link to "the activities you have edited"**, although
    `/api/activities` takes an `edited` filter, because the list's URL state
    (`listState.ts`) has no such filter to link to. Adding one is T21.

### T12 — Gear
- **Backend:** type the remaining `/api/gear*` endpoints (CRUD, `bulk-assign`, `defaults`).
- **Build:**
  - [x] gear cards with a wear bar against the retirement distance, and a "show retired"
    toggle
  - [x] add/edit dialogs (the old UI used seven chained `window.prompt`s)
  - [x] retire / delete
  - [x] bulk reassign with a dry-run preview
  - [x] default gear per activity type
- **Notes:**
  - `/gear` sits beside `/settings` behind the corner icon, as the nav rule asks. Two
    small icons rather than a menu: a dropdown would be a new shadcn component for two
    links.
  - **Assigning replaces gear of the same kind, so a bulk assign is also the
    correction.** Put the Nimbus on every run, then put the Novablast on the 2026 runs,
    and those runs change shoes rather than wearing both. That is the whole of
    "retroactively switch a pair of shoes across a range".
  - **Nothing is applied until the preview has been seen.** The preview is the
    backend's own `dry_run`, so the count is the same query the apply will run, not a
    guess made in the browser; changing any filter clears the count again. A dry run
    deliberately does **not** invalidate the caches — it changed nothing.
  - **Retire and delete are different, and the dialog says so.** Retiring keeps the
    history and takes the item out of the selects; deleting drops its assignments with
    it, and the confirm names how many.
  - **A null in a PATCH is a clear, not an omission.** The handler passes
    `exclude_unset`, so `{"notes": null}` empties the notes and a field left out is
    untouched — `test_a_patch_can_clear_a_field` pins it. A blank distance field means
    "no limit", so it goes as null rather than 0.
  - **`useGear` and `useGearCollection` share one key and one fetch.** Two query
    functions on `["gear"]` would race and hand one caller the other's shape; the
    select narrows it for the Edit dialog, which wants only the items.
  - **`POST /api/gear` and `PATCH /api/gear/{id}` take different models.** `source`
    and `garmin_uuid` are creatable only: an item imported from Garmin does not become
    a manual one by being edited. Both bodies `forbid` extra keys, which is why an
    unknown or mistyped field is now a **422** naming the key rather than the 400 it
    was — `test_bad_gear_payload_is_a_client_error` pins the split, and a body the
    model accepts and `create` then refuses is still a 400.
  - **The wear bar's colour always comes with its word.** "In use" / "Near its limit" /
    "Past its limit" / "Retired", because amber against green is not a reading.
  - Cards are ordered by what needs attention: over the limit, near it, then by
    mileage, retired last however far they ran.
  - **The Trends gear filter appeared on its own**, as T10c said it would:
    `/api/aggregate/filters` now returns the three items and the select renders.
    Filtering the page to one pair of shoes gives 207 activities and 1,115.6 km.

### T13 — Performance check
- [x] time the largest activity page and the all-activities heatmap (frame budget under
  16 ms on hover)
- [x] check the bundle: the main chunk was ~317 kB gzipped as of F9, mostly ECharts.
  Lazy-load charts per route if needed.
- [x] if a chart lags: add LTTB downsampling on the backend (an optional `max_points`)
  rather than in the browser
- Record the numbers in the commit message.
- **Notes:**
  - **The app was shipping every byte uncompressed.** `StaticFiles` does not compress,
    so the browser was sent all 1,221,703 bytes of the main chunk however politely it
    asked for gzip. One line of Starlette's own `GZipMiddleware` (not a new
    dependency) takes a first load of `/status` from **1,410 kB to 450 kB**. That is
    the whole of this task's win, and it was invisible in the build output, which
    reports the gzipped size of a file nobody was gzipping.
  - **Nothing on this box can meet a 16 ms frame budget, and the reason is the
    absence of a GPU, not the app.** Measured with `frontend/scripts/measure.mjs`
    (new, committed, so the numbers can be retaken on a real machine), 80 pointer
    moves each:

    | What | ms per move |
    |---|---|
    | Hovering a plain heading — the harness's own floor | 16.8 |
    | A chart on `/health`, no map on the page | 81.5 |
    | A chart on `/trends`, no map on the page | 85.2 |
    | A chart on `/activities/21048126834`, which has a map | 377.1 |

    Subtract the floor and a chart costs ~65 ms. The same chart on a page with a map
    costs ~360 ms, because the crosshair moves the map's cursor dot and every move
    repaints WebGL through SwiftShader — the ~233 ms/frame T04 and T06 already
    measured for the basemap alone, carrying nothing. The hover plumbing itself is
    already as narrow as the rules ask: two selectors subscribe, and the store drops a
    write that names the same sample.
  - **No chart is big enough to need downsampling, so the LTTB contingency does not
    fire.** The largest activity in the database has **1,993 samples** (`Cardio`,
    2025-02-15) and the largest GPS one **1,605 points** (`21048126834`, the 16.9 km
    long run). `/api/activities/{id}/streams` on the biggest is 110 kB in 30 ms.
  - **T06's note is wrong by a factor of ten.** It says that long run is "~16,900
    points"; it is 1,605. The figure looks like its 16.9 km read as metres. The
    conclusion it supported — that replay is slow here — stands, for the GPU reason
    above, but the count does not.
  - Backend timings on the real 488-activity copy, warm: `/api/heatmap` 16 ms
    (191 kB, 10,853 cells), `/api/aggregate` 13 ms, `/api/performance` 17 ms,
    `/api/reports` 11 ms, `/api/trends?days=730` 68 ms (156 kB),
    `/api/activities?limit=50` 21 ms. Nothing here is near a budget.
  - **The maps are correctly out of the main chunk**: zero mentions of `maplibre` or
    `deck.gl` in it, and `/status` fetches 450 kB against `/map`'s 1,184 kB. ECharts
    is in it and stays there — splitting it per route would not help Status, which
    has charts of its own, and 450 kB compressed for the whole app is not a problem
    worth that complexity.

### T20 — Prove the one-command install
- **Found in:** T03c. The production image has not been rebuilt since the React
  frontend landed, so `docker compose up -d` serving the built SPA is untested. Only
  `api-dev` and `ui-dev` have run since F4.
- **Build:**
  - [x] `docker compose build app`, then `docker compose up -d`, and open the app on
    its own port: nav, an activity page and the Edit dialog, in both themes
  - [x] check the image carries `garmin_analytics/ui/` (the Docker build runs
    `npm ci && npm run build`), and that the SPA fallback serves a deep link
  - [x] fix what the check finds, or add a row for it if it is not a small fix
- **Careful:** the owner's data is in that container. Don't recreate its volume, and
  ask before stopping it.
- **Done when:** a fresh `docker compose up -d` serves the React app.
- **It works.** `docker compose up -d` serves the React app from the image, and the
  README's claim is now something that has been run rather than something written.
- **Notes:**
  - **The owner's `app` container did not exist at all** — only `api-dev` and `ui-dev`
    have run since F4, exactly as this card said. Nothing had to be stopped, and
    `garmin-analytics-data` was never mounted: the check ran as its own compose
    project on its own empty volume (`garmin-t20-data`) and its own port (8099), from
    an override file, so it was a genuine first-time install rather than a restart of
    a populated one. Both are gone again; the owner's volume is untouched (139.7 MB,
    still dated 2026-09-24) and the dev pair stayed up throughout.
  - **What was checked, on the built image and not on Vite:**
    - the image carries `garmin_analytics/ui/`: `index.html`, 22 JS and 3 CSS assets
      under `assets/`, installed into site-packages by the wheel;
    - a first run on an **empty** volume comes up healthy and draws `/status` with no
      errors — dashes, "Not enough data to judge", "Garmin not connected" — rather
      than a broken page;
    - a first run with `GA_SEED_DEMO=1` seeds 1,153 synthetic activities and serves
      `/status`, `/activities`, `/trends`, `/health` and `/map` with **no console
      errors on any of them**;
    - the activity page (`/activities/seed-001150`) in light: Mapbox basemap, the
      route coloured by pace, gear chips, the route link, the playback control and
      both charts. The Edit dialog in dark: every field, the two gear selects and the
      route select;
    - the SPA fallback serves a deep link (`/activities/<id>` → 200 `text/html`) and
      a missing asset still 404s;
    - **assets are compressed** — the main chunk arrives as 390,208 bytes rather than
      1,221,703, so T13's fix is in the image;
    - **a restart keeps the data**: an edited title, an RPE and a gear item created
      through the API were all there afterwards, with the day range unchanged.
  - **Nothing had to be fixed.** The only defect the check could have found had
    already been found by T13 an hour earlier, and the image was built after it.
  - The image is 368 MB and the build took about four minutes on this box. Free disk
    went from 9.3 GB to 8.0 GB, which is above the 6 GB the cache-prune automation
    watches for. No image or volume belonging to another project was touched.

### T21 — Activity list: an "edited" filter
- **Found in:** T11b. The Settings "Your edits" panel wants to link to the activities
  it is counting, and cannot: `/api/activities` takes an `edited` filter, but the
  list's URL state does not.
- **Build:**
  - [x] `edited` in `listState.ts` (URL `edited=1`, like `race=1`), a control in
    `ActivityFilters`, and `clearFilters` clearing it
  - [x] the Settings edits panel links to it
- **Done when:** the filter survives Back, and the link from Settings lands on the
  edited activities.
- **Notes:**
  - **Switching it on drops the date bounds, as Races does**, and for the same
    reason: edits are rare and scattered across four years, so "edited in the last
    30 days" reads as a broken filter rather than as a true answer.
  - **The link from Settings has to say that itself.** A missing `start`/`end` in the
    URL means the store's default range, so `/activities?edited=1` would land on the
    last 30 days and usually show nothing — the bug was visible the first time the
    link was followed. The query is now one exported constant,
    `EDITED_ACTIVITIES_QUERY`, and a test asserts it parses to exactly the state the
    toggle produces, so the link and the control cannot drift apart.

### T14 — Cleanup and frontend README
- [x] `frontend/README.md`: how to run (dev, build, Docker), the folder structure, and
  "how to add a chart" and "how to add a map layer", each with a short example
- [x] remove leftovers: dead components, unused tokens, TODOs
- [x] update the note at the top of the root `README.md`
- **Notes:**
  - **There was almost nothing to remove, which is the useful finding.** No TODO,
    FIXME or HACK anywhere in `src`. No module that nothing imports. No unused token:
    the ones that look unused (`deltaGood`, `status.serious`, `kind.walk`, …) reach
    the UI through `cssVariables()` as `--ga-*` and are used as Tailwind classes, so
    a grep for `tokens.x` cannot see them. `knip` could not be run — it exhausts this
    box's memory on `schema.ts` — so the sweep was done by hand.
  - **Three things did go.** `useGearDetail` and its two query keys, which T12 wrote
    and never used (`GET /api/gear/{id}` stays typed and tested without a page of its
    own, as `DELETE /api/routes/{id}` does since T05c); `toGearRecord`'s export, which
    only its own module needs; and `NotBuiltYet`, the catch-all route's placeholder.
    That last one had gone from true to false: it said "Not built yet" on any unknown
    address, and everything is built. It is `NotFound` now — "There is nothing at this
    address."
  - The root README's rebuild banner is gone; the paragraph in its place names the
    views that exist and points at `PLAN.md` as the history rather than the plan.
    `CONTRIBUTING.md` now points at `frontend/README.md` for day-to-day work.

---

### T22 — Seeder: a weigh-in series worth smoothing
- **Goal:** every analytic in this phase is demonstrable tonight, against seeded data,
  with no Fitbit account. The seeder already writes `body_composition`; what it writes
  has to look like a real scale.
- **Files:** `garmin_analytics/seed/synthetic.py`, `tests/test_seed.py`.
- **Build:**
  - [x] hydration noise on every reading, so a single day is never a trend
  - [x] weigh-ins cluster and gap the way a person does — runs of daily mornings, then
    a week away — rather than an even 60 % coin flip
  - [x] body fat follows the weight it came from, so fat mass and lean mass separate
  - [x] a test that pins the noise-to-drift ratio: the 7-day trend moves less than the
    day-to-day spread

### T23 — Fitbit OAuth: authorize → code → token → refresh
- **Goal:** the whole Authorization Code + PKCE flow, offline-testable. The credential
  arrives tomorrow, so nothing here may depend on having one to be correct.
- **Files:** new `garmin_analytics/ingest/fitbit.py`, `tests/test_fitbit_auth.py`.
- **Build:**
  - [x] PKCE verifier/challenge, state, and the authorize URL (scope `weight`)
  - [x] code → token, refresh rotation (a refresh returns a *new* refresh token; losing
    it means re-authorising), 401 → refresh → retry once
  - [x] token cache on the data volume, 0600 in a 0700 directory, like Garmin's
  - [x] client id/secret from the environment, never from the database, never logged
  - [x] a one-method injectable transport, and tests over handcrafted payloads —
    including Google's `UNAUTHENTICATED` error shape, which is what 401 looks like now
- **Notes:**
  - **Nothing here has touched Fitbit's servers.** Every path is driven through an
    injected transport over payloads written from Fitbit's own documentation: the
    exchange, the rotation, the surprise 401, the 429, and both error envelopes. What
    is proven is that given those payloads this code is right; what is unproven is that
    Fitbit sends them. See `HANDOVER-FITBIT.md`.
  - **The refresh path is not an annual event here.** A PKCE access token lasts eight
    hours and Fitbit rejects any other `expires_in`, so almost every sync refreshes. And
    Fitbit *rotates* the refresh token — the old one dies the moment a new one is
    issued — so `FitbitClient` holds the token directory, not just the tokens, and
    writes the rotation before it does anything else with it. A rotation used for the
    current run and not written down fails hours later with nothing to point at.
  - `Accept-Language: en_GB` is sent on every data request. The default follows the
    account's locale, and a silent switch to pounds would write a number three digits
    wrong into a column called `weight_kg`.
  - The cache is created with `O_CREAT, 0o600` rather than written and then chmod-ed:
    between those two steps a world-readable refresh token is on disk.
  - `Credentials` and `Tokens` both override `__repr__`. A secret in a traceback is a
    secret in a log.
  - The redirect URI is one constant (`http://localhost:8000/api/fitbit/callback`) with
    one override, `GA_FITBIT_REDIRECT_URI`. Fitbit matches it byte for byte and it is
    sent twice — in the consent URL and in the exchange — so the exchange takes it from
    the pending authorization rather than re-reading the environment, where an edit
    between the two calls would break it invisibly.

### T24 — Fitbit ingest: weigh-ins by date range
- **Goal:** years of history inside a 150 requests/hour budget, raw-first and resumable.
- **Files:** new `garmin_analytics/ingest/fitbit_sync.py`, `garmin_analytics/ingest/normalize.py`,
  `garmin_analytics/cli.py`, `tests/test_fitbit_ingest.py`.
- **Build:**
  - [x] the date-range form of `body/log/weight` (31-day maximum per call), so a
    three-year backfill is ~36 calls, not ~1,100
  - [x] raw-first: every response archived under its own endpoint before normalising
  - [x] normalise to `body_composition`, idempotent by day, earliest reading wins (D5)
  - [x] a `fitbit_body` watermark, and a resumable backfill that stops on 429 with the
    window it got to rather than losing the run
  - [x] `garmin-analytics fitbit` CLI: `connect`, `sync`, `status`, `disconnect`
- **Notes:**
  - **The window size is the whole design.** Three years day by day is 1,096 requests
    against a budget of 150 an hour — an eight-hour job that is mostly sleeping. The
    31-day range form of the same endpoint returns every reading in the window, with
    body fat and BMI, and makes it **36 requests**. A test asserts that number, because
    if the range form ever stops working the fallback is not "slower", it is "no".
  - The normaliser lives in `normalize.py` beside Garmin's, not in the Fitbit module,
    and takes both `{"weight": [...]}` and a bare list — so T25's export importer and
    the API path are the same function and cannot drift about what a kilogram is.
  - **A manual entry is not a late-evening weigh-in.** Fitbit writes `time` as
    `23:59:59` when an entry was logged without one, which sorts as the last reading of
    the day and would beat the real 07:00 one under D5. It is ordered last instead, and
    only wins when it is alone.
  - Body fat is left `None` when Fitbit does not send one, rather than defaulting to
    zero: a 0 % reading would draw a lean-mass line through the athlete's whole body
    weight on the Health page.
  - A 429 **stops** the run with its watermark intact instead of raising — losing 30
    completed windows because the 31st hit the limit would be worse than useless — and
    the run stops on its own ten requests short of the budget, because the budget is
    shared with the rest of the app.
  - A re-sync re-reads 45 days behind the watermark. Fitbit lets a weigh-in be edited
    or back-dated after the fact; the upsert is keyed by day, so re-reading is free and
    not re-reading is a wrong number that never corrects itself.
  - `fitbit status` makes no network call. A Settings page that has to ask Fitbit
    anything spends one of 150 requests every time it is opened.


### T25 — Fitbit export importer (Google Takeout)
- **Goal:** the no-credentials path. It is the fallback if Google retires the API and
  the fastest way to load history without touching the rate limit.
- **Files:** new `garmin_analytics/ingest/fitbit_export.py`, `tests/test_fitbit_export.py`.
- **Build:**
  - [x] route by shape, not by path, the way `export_zip.py` does — Takeout's layout
    moves and a renamed directory must cost nothing
  - [x] both shapes Fitbit exports weight in: the JSON logs and the CSV
  - [x] raw-first, then the same normaliser the API path uses, so the two cannot drift
  - [x] tested against a ZIP the test builds itself
- **Notes:**
  - **Two traps, and both produce numbers that look right.** `03/01/19` in a Fitbit
    export is 1 March 2019; read day-first it is 3 January — a plausible date in the
    right year, wrong by two months, and nothing downstream can detect it. And the
    export follows the account's *original* unit setting without saying which it used.
  - **The unit is inferred from arithmetic, not from a label or a guess.** 75 and 175
    are both plausible weights for a person, so the number decides nothing. The
    record's own BMI does: weight and BMI together imply a height, and a weight in
    pounds implies one of about 2.6 m. Every record votes and the majority wins, so one
    record with a BMI of 0 cannot convert a decade of history. No BMI anywhere means no
    evidence, and metric — what Fitbit documents — stands.
  - The export shares `normalize_fitbit_weight` with the live sync rather than
    reimplementing it. `canonical_records` is the only place the export's quirks live;
    everything after it — D5, the missing-fat rule, the rounding — is one function, so
    the two paths cannot disagree about a kilogram.
  - **The import writes its own watermark, `fitbit_export`, not `fitbit_body`.** That
    one is the live sync's resume cursor, and a ZIP's coverage is not a day the sync has
    reached; overwriting it would send the next sync back to the start of the account.
    The raw documents still go in under `fitbit_body`, because it is the same data and
    `/api/raw/{endpoint}/{ref_key}` should find either.
  - A weight outside 25–300 kg is dropped with a warning. That is not an unusual
    athlete, it is a column read as something else, and 6,000 kg would be the entire
    y axis of the Health chart.
  - Tested against ZIPs the tests build. A real export is megabytes of one person's
    history and this repository is public-bound.


### T26 — Body analytics and `/api/body`
- **Goal:** the analytics the owner asked for, as pure functions with hand-derived
  tests, behind one typed endpoint.
- **Files:** new `garmin_analytics/analytics/body.py`, `garmin_analytics/api/schemas.py`,
  `garmin_analytics/api/server.py`, `tests/test_body.py`.
- **Build:**
  - [x] EWMA trend over the raw weigh-ins, gap-aware — a 10-day gap must not let one
    reading jump the trend
  - [x] fat mass and lean mass from weight × body-fat %
  - [x] weigh-in consistency: readings per week, longest gap, coverage of the window
  - [x] race-day projection for 2027-01-15 from the recent trend slope, with a plain
    statement of the window it was fitted over
  - [x] weight trend aligned to CTL, and a per-kg performance series
  - [x] `GET /api/body`, Pydantic models, then `npm run gen:api`
- **Notes:**
  - **The gap rule is the part that needed thinking about.** Textbook continuous-time
    EWMA sends the weight on a new reading to 1 as the gap grows, so a weigh-in after a
    month away *becomes* the trend. That is right about the old estimate being stale
    and wrong about the new one being reliable — it is one number with ±0.6 kg of
    hydration in it, taken after a fortnight of not weighing. `MAX_STEP = 0.5` caps it:
    one reading closes half the gap, and re-establishing the trend takes weighing in
    again. Two tests pin both halves.
  - **The projection refuses to answer rather than answering badly.** Under 8 readings
    or under 28 days of trend in the 56-day window returns null. A line through three
    points is a straight face on a coin toss, and the owner would have no way to tell.
  - **The pace figure is a rule of thumb and says so in three places** — the constant's
    comment, the Pydantic model's docstring, and the field name itself
    (`rule_of_thumb_s_per_km`). ~2 s per mile per pound is 2.7 s per km per kg. It is a
    rough average across runners, it assumes the weight lost is fat, and it knows
    nothing about this athlete.
  - **"Pace per kg" was rejected on merit.** Running's metabolic cost is already roughly
    proportional to bodyweight, so speed is mass-normalised to begin with and dividing
    it by mass again produces a number with no meaning. What is built instead is run
    speed and bodyweight both **indexed** to the start of the window: if speed is up 4 %
    while weight is down 2 %, the reader can see the improvement is not the scale — and
    the code has not invented a conversion to tell them so. W/kg for rides *is* built,
    because on a climb speed really is very nearly linear in it.
  - W/kg divides by the *trend*, not by that morning's reading. Hydration noise in the
    divisor would come out in the performance series looking exactly like form.
  - On eighteen seeded months: fat mass −4.66 kg, lean mass +0.77 kg, run speed index
    114.4 against a weight index of 95.3.


### T27 — Health: the body-composition section
- **Goal:** the headline is the trend, not the reading.
- **Files:** `frontend/src/features/health/`, `frontend/src/charts/body/`.
- **Build:**
  - [x] the trend line as the primary series, raw weigh-ins as faint points behind it
  - [x] fat mass vs lean mass over time
  - [x] cards: current trend weight, change over the window, weigh-in consistency,
    projected race-day weight
  - [x] the section hides itself when nothing has ever been weighed
- **Notes:**
  - **The fat/lean chart was wrong the first time and the screenshot is what showed it.**
    Drawn as levels, lean sits near 63 kg and fat near 11, so one axis over both spans
    50 kg and the 3 kg that actually moved over a year is a pixel: two flat parallel
    lines, which is exactly the failure the chart was added to avoid. Two y-axes would
    fix it and are not allowed. It plots **change** from the start of the window
    instead — both series begin at zero, so the only thing to read is the divergence,
    which is the question. The levels are on the cards above, where a single number
    belongs, and in the tooltip.
  - The weight chart is a **scatter plus a line**, not two lines. A line through the raw
    readings would read as a second, equally valid answer to the same question.
  - The axis is bounded to the *readings*, not to the trend: fitting to the trend would
    clip the dots the chart exists to show alongside it.
  - Six cards. The first is the trend with the last reading as its small caption, which
    is the section's argument in one control. Fat down is green and lean down is red —
    the same kilogram, opposite verdicts.
  - The race card carries the window it was fitted over and **never a time**. A card is
    one number and a label, and a time estimate on a card is the fastest way for a rule
    of thumb to be read as a forecast. The seconds live in the note below, in the same
    sentence as the words that qualify them, and a test asserts those words are there.
  - The whole section returns null when nothing has ever been weighed. On the owner's
    real database that is the case today, and the Health page is unchanged — verified
    on :5173 as well as on seeded data.
  - Looked at in both themes at `/health?days=365`; screenshots in `~/garmin-review/E/`.
    No console errors from the app in either.


### T28 — Trends: weight against training load, and pace per kg
- **Goal:** the two analytics that need the activity data, where the activity data lives.
- **Files:** `frontend/src/features/trends/`, `frontend/src/charts/body/`.
- **Build:**
  - [x] weight trend and CTL over one shared day axis, one y-axis each (see the note),
    so a build block's cost in bodyweight is visible
  - [x] pace per kg over time, so improvement is not confounded by weight change
  - [x] both hidden when there are no weigh-ins
- **Notes:**
  - **Weight and CTL are two panels, not two lines.** Kilograms and a training-load
    index are not the same quantity and their ranges are nothing alike — a build takes
    CTL from near zero to 90 while the scale moves 4 kg — so any single axis holding
    both either flattens the weight into a straight line or scales one of them against
    a second axis that is never drawn. Twin axes are what people reach for here and
    they are not allowed (Rules), for exactly that reason: an undrawn scale invites the
    reader to compare two shapes stretched by different amounts. Stacked panels over
    one shared day axis — literally the same axis object, asserted by a test — say the
    same thing with both series in their own units.
  - **The load panel's axis is floored at zero.** Rounding 2–90 out to a round step put
    the bottom tick at −50, and a negative training load is not quiet padding, it is a
    quantity that cannot exist drawn as though it could. Caught in the screenshot.
  - **The load panel's colour was wrong in dark mode and a test now covers both themes.**
    It took the magnitude ramp's top step, which is near-white in dark — the same colour
    as the weight panel's ink above it, so the two panels read as one line cut in half.
    The ramp's *middle* step is the same solid blue in either theme.
  - Run speed and weight as two indices really do belong on one axis, unlike the pair
    above: both are percentages of the same starting week, so the axis compares like
    with like. On seeded data speed reaches 114 % while weight falls to 95 %.
  - W/kg is a scatter on a *time* axis — one point is one ride under its own conditions,
    a line would claim a value for the fortnight between two of them, and even spacing
    would hide that fortnight entirely.
  - The section is not filtered, and says so beside its heading when a filter is on,
    the way the performance block already does.
  - Looked at in both themes on `/trends`; screenshots in `~/garmin-review/E/`.


### T29 — Settings: connect Fitbit
- **Goal:** the owner can connect the account tomorrow without reading any of this.
- **Files:** `frontend/src/features/settings/`, `garmin_analytics/api/server.py`.
- **Build:**
  - [x] a Fitbit panel beside the Garmin one: authorize link, paste the redirect URL,
    connected state, disconnect
  - [x] import an export ZIP by path, for the offline route
  - [x] the `fitbit_body` watermark in the sync panel
- **Notes:**
  - Measured on eighteen seeded months: the scale moves 0.62 kg day to day, a
    7-reading trailing mean moves 0.099 kg — a factor of **6.2**. That ratio is the
    argument for the whole smoothing approach, and it is now asserted (at 3×) rather
    than claimed.
  - **A real bug fell out of it.** BMI was generated with its own independent noise
    draw, so a row could report a weight that was down and a BMI that was up. Nothing
    read both at once, which is the only reason it survived. BMI is now that morning's
    reading over the same height.
  - Weighing is a two-state habit (~2 % chance a day of lapsing, ~12 % a day of coming
    back) rather than an even coin flip. It produces 74 % coverage with gaps of up to
    six weeks, which is what T26's gap-aware EWMA and the consistency card need to have
    something to cope with. An independent flip at the same coverage essentially never
    misses eight days running.
  - Fat and lean are now modelled separately — lean follows the block, fat is the
    remainder — so over eighteen months fat mass falls 4.3 kg while lean mass rises
    0.7 kg. Before this the fat percentage was a straight line with noise on it and the
    two masses fell in parallel.
- **Notes:**
  - **The panel has three states and says which one you are in.** No app registered,
    registered but not authorised, and connected are three different problems needing
    three different things; a disabled button would leave the owner guessing. The
    first state prints the exact redirect URL that has to be registered at
    dev.fitbit.com, because Fitbit matches it byte for byte.
  - **The PKCE verifier never reaches the browser.** `GET /api/fitbit/authorize-url`
    returns the URL and nothing else; the verifier and the state are held in memory on
    the server, keyed by state, and looked up when the code comes back. A test asserts
    `code_verifier` is not in the response. Held in memory rather than on disk for the
    same reason the Garmin MFA challenge is: it is an auth context, and a restart
    mid-flow costs one click.
  - **Two ways in, because the redirect may not come back here.** `GET
    /api/fitbit/callback` completes the flow automatically when the registered redirect
    does point at this app — and that is a setting at dev.fitbit.com that nothing in
    this repo controls, so pasting the address bar into the panel does the same thing.
    The callback renders one escaped sentence of HTML: Fitbit lands a *browser* there,
    not the app, so a failure has to be readable, and `error` arrives in a query string.
  - **The sync is synchronous, deliberately.** A three-year backfill is ~36 requests
    paced a second apart — under a minute, which is short enough to answer in a request
    and not worth a background job with its own status row. A rate-limited run reports
    what it got and when to come back; the copy is tested for not reading as a failure,
    because it is not one.
  - The export importer takes a **path**, not an upload: the archive is hundreds of
    megabytes, this app is single-tenant on the owner's own machine, and streaming a
    multipart upload through it to write it straight back to disk is work for no gain.
  - The sync panel needed no change — `WatermarkTable` renders every row of
    `sync_watermark` whatever wrote it, so `fitbit_body` and `fitbit_export` appear the
    first time they run. Its comment said "each Garmin endpoint"; that is now true
    again by being correct rather than by being narrowed.
  - **The import was exercised end to end against a running server**, with a ZIP built
    for the purpose: 168.4 lb came back as 76.38 kg, the unit inference reported `lb`,
    and `/api/body` picked the rows up. The consent and exchange were not — that needs
    the credential.

### T30 — Auto-sync: Garmin and Google Health every 6 hours
- **Goal:** the data is current without anyone pressing Sync.
- **Files:** `garmin_analytics/ingest/auto_sync.py`, `garmin_analytics/api/server.py`,
  `garmin_analytics/config.py`, `docker-compose.yml`.
- **Build:**
  - [x] a scheduler thread in the server process, started and stopped by the app's
    lifespan; `GA_AUTO_SYNC_HOURS` (default 6, `0` off), off in `api-dev` and in tests
  - [x] each run: Garmin's incremental `connect.sync`, streams for activities that have
    none (25 a run at most), derive only if something arrived; then Google Health's
    `sync_body`. Each source is skipped when not connected, and one failing does not stop
    the other
  - [x] its own `sync_status` row (`auto`), and `GET /api/sync/auto` for Settings
  - [x] a manual sync and an automatic one never run together: a due run waits ten
    minutes for a backfill, and both Sync buttons answer 409 while a run is in progress
- **Notes:**
  - **The incremental sync, not the backfill.** The backfill re-reads the whole activity
    list and re-clusters every route each time; the incremental sync resumes each
    endpoint from its watermark with three days of overlap, so late-arriving sleep and
    HRV still land. It comes to a few dozen requests a run.
  - **Derive runs only when there is something to derive.** Measured on the real data:
    best efforts 2.2 s, route clustering 29.8 s. A quiet run, which is most runs, pays
    neither. A test pins that.
  - **The interval is counted from the last run, which is stored in the database**, not
    from process start. A redeploy does not reset the clock. A server that boots with a
    run overdue runs it two minutes later. That is how the eleven days behind on
    2026-10-08 get caught up without a button. A run that died mid-way counts from its
    start, so a crash cannot stall the schedule.
  - **No retry loop.** A failed run (an expired Garmin session, withdrawn Google consent)
    is recorded with its message and tried again at the next interval. A broken
    credential costs one failed run every six hours, never a hammering of an unofficial
    API.
  - **A latent bug fell out of it.** A rate-limited Google Health sync writes the
    watermark status `rate_limited`, which the `Watermark` schema did not allow, so
    `/api/sync/status` would have answered 500 until the next good run. Automatic runs
    make that more likely, so the status is now allowed, and the watermark table shows it
    in amber.
  - `api-dev` had been created before its `GA_AUTO_SYNC_HOURS: "0"` existed, and its
    `--reload` picked up the new code with the scheduler on. Its token cache has always
    been empty, so nothing could leave the machine, but it was recreated so that is true
    by configuration as well as by accident.

### T31 — Settings: it syncs on its own, and says so
- **Goal:** the owner can see that sync is automatic, when it last ran and next runs,
  and what to do when a source fails, without reading logs.
- **Files:** `frontend/src/features/settings/`, `frontend/src/api/queries/useStatus.ts`,
  `frontend/src/features/shell/AppShell.tsx`, `frontend/src/lib/format.ts`.
- **Build:**
  - [x] one line under "Last synced": "Syncs on its own every 6 hours · last ran 2 h ago ·
    next in 4 h", or that it is running, or off
  - [x] a source that failed in the last run, by the name the owner knows it by, with
    its message, which already says what to do
  - [x] Sync now disabled while an automatic run holds the network (the server would
    answer 409)
  - [x] a page left open refreshes when a run lands
- **Notes:**
  - **The shell polls, not the panel.** `useAutoSync` is mounted in `AppShell`, once a
    minute, so whatever page is open is refetched when a run finishes. It watches
    `finished_at` change rather than `running` go false: a quiet run is a few seconds
    long and would fall between polls almost every time.
  - "Last synced" needed no change. `lastSyncedAt` already takes the newest of every
    watermark's `last_run_at`, and an automatic run moves those like any other.
  - **Errors are hidden when it is off.** The screenshot showed a failed Garmin run
    under "Automatic sync is off", which reads as a live problem and is not one. A test
    pins it.
  - Looked at in light and dark on :5173 against `api-dev`, with a failed run written
    into that service's scratch copy of the database and removed afterwards.
    `FitbitPanel.tsx` fails `prettier --check` on `master` already; it is left alone
    here.

### T32 — Google sign-in: when it ends, said before it does
- **Goal:** the weekly reconnect that D9 costs happens before a sync fails, not after.
- **Files:** `garmin_analytics/ingest/fitbit.py`, `garmin_analytics/ingest/fitbit_sync.py`,
  `garmin_analytics/ingest/auto_sync.py`, `frontend/src/features/settings/`.
- **Build:**
  - [x] the token cache records when Google issued the refresh token, carried through
    refreshes that do not rotate it; the sign-in ends 7 days after, or when Google says
    (`refresh_token_expires_in`)
  - [x] `/api/fitbit/status` reports `signin_expires_at`, from the cache, no network call
  - [x] Settings: "renew by Oct 15 (in 7 d)" in grey, amber inside the last day, red once
    ended, and a Reconnect button. The consent steps open on their own once it is urgent.
  - [x] a refused refresh says what happened (the Testing sign-out) instead of blaming
    spent codes. A refused code still talks about codes.
  - [x] an automatic run's failure is not shown once that source has synced cleanly
    since
- **Notes:**
  - **Found on the first real automatic run**, 2026-10-08 08:06: `invalid_grant: Token
    has been expired or revoked`, eleven days after consent. The app is in Testing, and
    leaving it needs a homepage and privacy-policy URL on an owned domain (D9).
  - **The clock counts from consent, not from the last refresh.** A refresh that keeps
    the refresh token carries the issue time forward. Only a rotated one restarts it.
  - A cache written before this has no issue time and shows no date. No guess is made:
    the file's mtime is the last *access-token* refresh, which happens hourly.
  - **The stale error was seen, not imagined.** The owner reconnected and synced by hand
    at 08:21. Settings went on showing the 08:06 failure, and would have until 14:06.
  - The consent steps are one component now, used to connect and to reconnect.
    Connecting over a live connection overwrites the cache, so no disconnect step is
    needed.
  - **Not looked at in a browser.** The screenshot was taken, with a fake token in
    `api-dev`'s scratch cache and removed afterwards, but the tool that reads images
    was unreachable. Its tests cover the three states.

### T33 — Activities: cards with a map beside each
- **Goal:** each activity in the list says what it was at a glance: where it went, or
  what it trained, and the numbers its type is judged by.
- **Files:** `garmin_analytics/api/server.py`, `garmin_analytics/api/schemas.py`,
  `garmin_analytics/api/preview.py`, `frontend/src/api/adapters.ts`,
  `frontend/src/features/activities/`, `frontend/src/map/staticMap.ts`.
- **Build:**
  - [x] list rows carry a simplified, encoded GPS track, time in each HR zone, and a gym
    session's exercises; batched per page, the detail endpoint unchanged
  - [x] the map is a Mapbox static image (one `<img>` per card, the route drawn by
    Mapbox); without a token, an SVG trace of the same track
  - [x] no GPS: strength shows a small body diagram shaded by muscle load and its top
    exercises; anything else shows its HR zones, or its type icon
  - [x] the stats on a card follow its kind: pace for runs, speed and power for rides,
    pace per 100 m for swims, sets, reps and volume for strength
  - [x] Cards / Table toggle and a sort menu, both in the URL; cards are the default
- **Notes:**
  - Decided with the owner, 2026-10-08: Mapbox static images over live maps (50 WebGL
    contexts on one page is past what a browser allows), per-type visuals for the 227
    activities without GPS, and the table kept behind a toggle.
  - **Cost, measured on the real database:** the list went from ~30 ms to ~0.5 s for a
    page of 50 before the route cache; with it, a page seen before is back to ~30 ms and
    a cold one is 0.2–0.4 s. Simplifying in Python is most of a cold page.
  - **What the real data has:** 265 of 492 activities have GPS. HR zones exist for few
    (14 of the latest 50; none of the swims), so most indoor cards show the sport's
    icon. A dive at full zoom over the sea is a route on plain water colour: correct,
    not a failed image.
  - The sort menu replaces the table's headers in the cards view only; the table keeps
    its headers.
  - **Routes come after the cards** (owner, same day: "the content shows up first and
    then the maps load"). The list sends `has_gps`; `GET /api/activities/previews`
    sends a page's routes. Cards are on screen in ~50 ms; maps fill in behind a
    placeholder and fade in. One card per row at every width (owner's call).
  - Looked at on real data (copy on :8818), light and dark, 1440 px and 390 px: rides,
    runs, strength, swims, other, and the table toggle.

### T43 — Map: the map before the heatmap, the heatmap before the ask
- **Numbered T34 in its commits** ("Claim T34"): renumbered once the `training-plan`
  branch, which had taken Phase 8, T34–T42 and D10–D13 meanwhile, was found.
- **Goal:** the Map page shows a map at once and the heat on it as soon as possible.
- **Files:** `garmin_analytics/api/cache.py`, `garmin_analytics/api/server.py`,
  `garmin_analytics/config.py`, `frontend/src/features/map/`, `frontend/src/map/`.
- **Build:**
  - [x] the analytics cache keeps an answer until the database changes, seen through
    the WAL as well as the main file; one write empties it
  - [x] the unfiltered heatmap is recomputed in the background at startup and once the
    data settles after a change, never while a sync runs
  - [x] the map code starts downloading when the page opens, alongside the heatmap
  - [x] a return visit opens the map where it last was and draws the heat on it when
    it arrives; a first visit still waits for the heatmap's bounds
- **Notes:**
  - **Measured before (real data, production build):** heatmap 1.2–1.55 s whenever
    the 30 s cache had lapsed, and the map library requested only after it. Map style
    requested at ~4.1 s in the headless test browser.
  - **After:** heatmap ~0.02 s from the warmed cache (0.2–0.4 s over HTTP in the test
    browser); style at ~3.4 s on a first visit and ~1.4 s on a return visit.
  - **Found on the way:** with no connection held open, SQLite deletes the WAL when
    the last connection closes and the next one recreates it empty, so counting the
    WAL's mtime as-is would have emptied the cache on every request. An empty WAL is
    left out of the version; `test_cache.py` covers it.
  - Making the aggregation itself faster tops out at ~0.45 s (reading 150k points is
    0.3 s on its own), so it was left as it is.
  - The unfiltered view spans every country with a GPS point, so Doha is a small spot
    on a map of half of Asia. Not changed here; worth its own look.

### T44 — Routes: a loop is one route however many times round
- **Numbered T35 in its commits** ("Claim T35"): renumbered with T43, for the same
  reason.
- **Goal:** the owner's loops are one route each, with the fastest lap round them; an
  out-and-back to the same turn is one route unless it goes much further.
- **Files:** `garmin_analytics/analytics/routes.py`, `garmin_analytics/api/`,
  `garmin_analytics/cli.py`, `frontend/src/features/routes/`.
- **Build:**
  - [x] match on ground: share of the distance run on the route, and share of the
    route run, both at least 75%; no distance filter
  - [x] a route's shape is one lap (`first_lap`), the median lap among clean ones;
    untouched routes are renamed from it; layout is loop, out and back or one way
  - [x] laps timed from the start line (`lap_splits`), a run once round from anywhere
    on the loop counted as a lap; fastest, median and per-attempt laps on the route
    page, best and median lap on the list
  - [x] segments on a loop are one lap long, averaged over an attempt's laps
  - [x] a sync files only new activities (no reshuffling); `fresh` (API, and
    `garmin-analytics cluster --fresh`) rebuilds every route nobody has edited
- **Notes:**
  - **On the real history (fresh rebuild):** 70 routes → 52 (25 loops, 19 out and
    backs, 8 one way). Bin Omran: 79 runs, a 1.64 km lap, 186 laps, fastest 11:05.
    The loop at 25.345, 51.522: 43 runs, 1.43 km, 173 laps, fastest 10:02. Lusail
    circuit (cycling): 3 rides, 5.43 km, 12 laps, fastest 12:40 (25.7 km/h).
  - **The live database is not regrouped yet.** After deploying, run
    `garmin-analytics cluster --fresh` once (the owner's call: it rewrites the routes
    table). No route had been edited by hand, so nothing the owner decided is lost.
  - A fresh rebuild takes ~15 s on this box; a sync with one new run ~0.2 s. The route
    list (1.1 s) and pages (≤0.3 s) are cached until the data changes.
  - The owner's "5.1 km Lusail loop" is the cycling circuit; the Lusail Marina runs are
    an out-and-back, 4 runs of 5.0–6.1 km.
  - Some laps are missed: a run that pauses at the line, or whose GPS drifts more than
    50 m off it, loses that lap (Bin Omran: 77 of 79 runs have one timed).

### T46 — Laps: from where the run began, and only whole ones
- **Goal:** every lap run round a loop is timed, and none that cut the loop short.
- **Files:** `garmin_analytics/analytics/routes.py`.
- **Build:**
  - [x] an attempt that starts on the loop is timed from its own start (`lap_start`);
    one that reaches the loop from elsewhere, from the route's start line
  - [x] a lap counts at 94–108% of the route's lap, not 85–120%
- **Notes:**
  - **Why laps were lost:** runs often start a few dozen metres from the route's
    start line (one at 52 m, outside the 50 m gate), or partway round, so the first
    lap was never closed. 481 of at least 576 laps were timed.
  - **After:** 497 timed, with the outliers gone. Bin Omran 186 → 198 laps; its record
    moves from 11:05 to 11:06, the 11:05 having been a short lap.
  - 95% of laps are within ±4% of the route's lap; the tail beyond 94–108% was corners
    cut and detours. Segments still use the route's start line, so they stay aligned.
  - Still missed: a run whose watch stops short of where it began, and one that pauses
    out of the gate's reach. Those laps are not whole.

### T45 — Map: open on home
- **Goal:** the Map opens on where the activity is, with home more than a dot.
- **Files:** `frontend/src/map/heatmapBounds.ts`, `frontend/src/features/map/`.
- **Build:**
  - [x] the opening view and every refit cover the busiest ~55 km square by GPS points
    and the squares round it (`heatmapFocusBounds`), not every cell
- **Notes:**
  - The unfiltered real history spanned Qatar to south India and Saudi Arabia, so the
    map opened on half of Asia. It now opens on Doha, Lusail and Al Wakra.
  - A filter to one trip makes that trip the busiest square, so it opens there. The
    heat elsewhere is still drawn: zooming out shows it.

### T47 — Routes keep their numbers
- **Goal:** `/routes/31` is the same loop before and after a regroup.
- **Files:** `garmin_analytics/analytics/routes.py`, `frontend/src/features/routes/RoutePage.tsx`.
- **Build:**
  - [x] `keep_route_ids`: each route takes the number most of its activities had, if
    free; contested numbers go to the route with more of those activities. A fresh
    rebuild calls it, so it renumbers nothing that still exists
  - [x] the clusterer's names carry the kept number
  - [x] a route page for a number that no longer exists says it was merged or
    regrouped, with a link to all routes
- **Notes:**
  - **Today's regroup undone on the live database** from the 11:31 dev snapshot's
    memberships (the last copy from before the regroup): 51 of 52 routes got their
    old numbers back; Bin Omran is #31 again, the 1.4 km loop #28, the QSC loop #4.
    Numbers of routes merged into another (Bin Omran's old #40, #69, ...) are gone;
    their pages say so.


### T34 — Schema v3: the plan's tables
- **Goal:** the database can hold a prescribed session, where it came from, and which
  activity fulfilled it, without touching anything that already exists.
- **Files:** `garmin_analytics/db/schema.sql`, `garmin_analytics/db/store.py`,
  `tests/test_store.py`.
- **Build:**
  - [ ] `plan_sources`: id, kind (`ics`), url, label, etag, last_modified, last_fetch_at,
    last_error, enabled
  - [ ] `plan_sessions`: keyed by (`source_id`, `uid`, `recurrence_id`) — day,
    `start_local`, `end_local`, sport, kind (`easy` · `long` · `quality` · `cross` ·
    `gym` · `rest` · `race`), `planned_min_m`, `planned_max_m`, `planned_duration_s`,
    title, description, `parse_status`, `withdrawn_at`
  - [ ] `plan_links`: `plan_session_id` ↔ `activity_id`, `link_type`
    (`auto` · `manual` · `ignored`), `score`, `linked_at`; unique on `activity_id`
  - [ ] `SCHEMA_VERSION` → 3, migration row, and the fresh-install path proved on an
    empty database
- **Notes:**
  - **`withdrawn_at` is the point of the table, not a soft-delete habit.** On 2026-09-19
    the owner deleted the Saturday Conversational Run series and a year of past
    instances went with it. A plan table that mirrors the feed would have rewritten
    October's adherence in November. A row that leaves the feed is stamped and kept, so
    a past week is always judged against what was prescribed at the time.
  - `recurrence_id` is what separates one Tuesday from the next inside a single weekly
    series, and what lets a moved or cancelled instance override its parent.
  - Nothing here is nullable for convenience: a session with no distance is a session
    with no distance (`rest`, `gym`), not one whose number was lost.

### T35 — Plan ingest: the ICS feed
- **Goal:** a private calendar URL becomes rows in `plan_sessions`, repeatably, with
  nothing kept in the repo and nothing printed to a log.
- **Files:** `garmin_analytics/ingest/plan_ics.py`, `garmin_analytics/cli.py`,
  `tests/test_plan_ics.py`, `tests/fixtures.py`.
- **Build:**
  - [ ] fetch over stdlib `urllib.request` behind an injectable transport, the way D7
    set for Fitbit, so the whole path is testable without a network
  - [ ] `ETag` / `If-Modified-Since` honoured; a 304 is a successful no-op run
  - [ ] VEVENT parsing: unfolding, escaping, `DTSTART;TZID=`, `DTSTART;VALUE=DATE`,
    `SUMMARY`, `DESCRIPTION`, `UID`, `RRULE`, `EXDATE`, `RECURRENCE-ID`, `STATUS`
  - [ ] recurrence expanded from the plan's start to race day + 7, in `Asia/Qatar`, so
    `day` is the local date `activities.day` already uses
  - [ ] a rule the parser does not support sets `parse_status='unsupported_rrule'` and
    is surfaced; it is never expanded on a guess
  - [ ] a session that is no longer in the feed gets `withdrawn_at`; it is never deleted
  - [ ] the raw ICS body goes to `raw_documents` like every other source
  - [ ] `ga plan sync` and `ga plan show --week`
- **Notes:**
  - **The feed URL is a credential.** Anyone holding it reads the calendar. It lives in
    `app_settings`, is masked everywhere it is returned, and must never reach a log line
    or an error message — including the ones `urllib` writes for you.
  - DST does not exist in `Asia/Qatar`, which removes the usual recurrence trap. Do not
    rely on that in the code; the conversion is still explicit.
  - Expanding from the feed's own window rather than from "today" is what keeps past
    weeks stable. Re-running the sync must not change a single completed week.

### T36 — Plan parse: prose into a prescription
- **Goal:** "Long run 18 km" and "Easy run 6.4 km" become numbers the matcher can judge,
  and the ones it cannot read say so instead of guessing.
- **Files:** `garmin_analytics/plan/parse.py`, `tests/test_plan_parse.py`.
- **Build:**
  - [ ] distances: `6.4 km`, `8-10 km`, `8–10 km` (en dash), `5K`, `21.1 km`; a range
    sets `planned_min_m` and `planned_max_m`, a single value sets both
  - [ ] durations: `45 min`, `1h30`, `05:00–08:00` from the event's own times when no
    distance is given
  - [ ] sport and kind from keywords — run, ride, gym, rest, race — with the owner's own
    titles (`DBRC Katara Hills`, `Olympic Track Ride`, `Lusail`) in the fixtures
  - [ ] **the Monday rule:** a Monday event's description carries that week's `Tue:` and
    `Fri:` targets, which override the generic text on those days' recurring series
  - [ ] a `GA: <day> sport=run dist=18km kind=long` line anywhere in a description wins
    over everything above, and is the only form that is exact rather than inferred
  - [ ] anything unresolved is `parse_status='unparsed'` with the text kept, never a
    silent default
- **Notes:**
  - **Why the Monday rule exists.** The DBRC Tuesday and Friday entries are single
    recurring series and cannot hold different text per week, so the owner put each
    week's numbers in that week's Monday event. Without this rule every Friday in the
    plan reads as the same prescription and the long-run progression — the whole point
    of the block — is invisible.
  - **Why hint lines are worth writing.** The Monday descriptions quote Higdon's
    prescription *beside* the owner's, deliberately, so the deviation is visible. Two
    sets of numbers in one paragraph is exactly the input a regex reads backwards. A
    `GA:` line removes the ambiguity for the dozen events that matter. Agreed with the
    owner 2026-10-08; the lines are generated from the plan, not typed by hand, and the
    prose above them is left alone.
  - Fixtures must be the real event text, copied from the calendar, not text invented to
    suit the parser. A parser tested on its author's examples proves nothing.

### T37 — Plan analytics: matching, and whether it is being followed
- **Goal:** every prescribed session gets a verdict, every week gets a number, and the
  question "is this working" gets an answer built from what the app already measures.
- **Files:** `garmin_analytics/analytics/plan.py`, `tests/test_plan.py`.
- **Build:**
  - [ ] match: same local day and a compatible sport; else ±1 day when that activity is
    unclaimed and the plan has nothing else on it, flagged `moved`; `manual` always wins
  - [ ] verdicts: `done` · `short` (under `planned_min_m`) · `over` · `moved` · `missed`
    · `unplanned` (an activity no session asked for)
  - [ ] a `rest` session is `done` when nothing was done; a run on a rest day is a
    violation, not a bonus
  - [ ] per week: sessions done / prescribed, km done / prescribed, long run yes or no
  - [ ] weighted adherence, rolling 4 weeks, with the Friday long run worth more than
    Wednesday's ride, and the weights named in one place
  - [ ] on-curve: prescribed weekly km against actual, and the CTL the remaining plan
    implies against the CTL trajectory
  - [ ] efficacy, from what exists: `performance.decoupling_history` over the long runs,
    `project_race_time` against the goal, `body.race_projection` against 85 kg
- **Notes:**
  - **One activity fulfils at most one session.** The unique constraint on
    `plan_links.activity_id` is what stops a single long run from satisfying both
    Thursday and Friday and producing an adherence number nobody earned.
  - Matching is recomputed, never stored as the truth: an activity retyped by the owner
    (`v_activities_included`) must move the match with it. Only `manual` and `ignored`
    links are persisted decisions.
  - **The honest weakness:** a 16 km run on a day prescribing 16–17 km is `done`, and a
    16 km run done at the wrong effort is also `done`. Adherence measures compliance,
    not execution. Decoupling is what says whether the sessions worked, and the two
    numbers must be shown together or the first one flatters.

### T38 — `/api/plan`
- **Goal:** the frontend can draw the plan, this week, and the verdict, and the owner can
  correct a match the matcher got wrong.
- **Files:** `garmin_analytics/api/server.py`, `garmin_analytics/api/schemas.py`,
  `frontend/src/api/schema.ts` (generated), `tests/test_api_schemas.py`.
- **Build:**
  - [ ] `GET /api/plan` — race, weeks to go, weekly prescribed vs actual, rolling
    adherence, the efficacy block, the verdict line
  - [ ] `GET /api/plan/week?start=` — one week's sessions with their verdicts and the
    activity each matched
  - [ ] `POST /api/plan/sync`, `GET /api/plan/source`, `PUT /api/plan/source` (the URL in,
    masked out), `DELETE /api/plan/source`
  - [ ] `PUT /api/plan/sessions/{id}/link` and `DELETE` — manual link, unlink, ignore
  - [ ] no plan loaded is a 200 with `source: null`, never a 404 or a 500
  - [ ] Pydantic models, then `npm run gen:api`, then commit the regenerated types
- **Notes:**
  - The empty state is the one that breaks in real use, twice before in this repo
    (`report` on an empty database, `serve` with no database file). Every endpoint here
    gets a test against a database with no `plan_sources` row.
  - The feed URL is returned masked, always, including straight after a `PUT` that set it.

### T39 — Auto-sync: the plan as a third source
- **Goal:** the plan follows the calendar without anyone pressing anything, the way
  Garmin and Google Health already do.
- **Files:** `garmin_analytics/ingest/auto_sync.py`, `tests/test_auto_sync.py`.
- **Build:**
  - [ ] `sync_plan` beside `sync_garmin` and `sync_fitbit`; `run_once` totals 3, not 2
  - [ ] `SOURCE_WATERMARKS` gains `plan`
  - [ ] no source configured is a skip, not a failure
  - [ ] a feed that 404s or 401s reports the owner-facing cause: the secret URL was reset
- **Notes:**
  - A 304 run is a success with nothing written. It must not look like a failure in
    Settings, and it must still move `last_run_at`.
  - Google rotates a calendar's private address when the owner resets it. That is the
    failure this will actually hit, and the message should say so rather than "404".

### T40 — Status: this week against the plan
- **Goal:** opening the app answers "am I on it" without reading anything.
- **Files:** `frontend/src/features/status/`, `frontend/src/features/plan/`,
  `frontend/src/routes.tsx`, `frontend/src/api/adapters.ts`,
  `frontend/src/api/queries/`, `frontend/src/charts/`.
- **Build:**
  - [x] a week strip on Status: each prescribed session as done, short, missed or
    to come, with the next one named — "Friday · long run · 18 km"
  - [x] one stat card: rolling 4-week adherence, with its delta
  - [x] the race panel's weekly-km bars get the prescribed line over them
  - [x] `/plan`: the full grid to race day, a row per week, click a session for the
    activity that matched it, and a control to re-link or ignore
  - [x] the verdict sentence at the top of `/plan`, adherence and efficacy in one line
  - [x] no plan loaded: one line and a link to Settings
- **Notes:**
  - **D11 was decided while this was queued, so `/plan` is in the nav.** Six items now:
    Status · Plan · Activities · Map · Health · Trends. The Rules line was amended with
    D11 and the "nav stays at five" comment in `AppShell.tsx` is gone.
  - Status colours always come with a label (Rules). "Missed" is a word, not just a red
    square, and red here means a session that did not happen, never a bad day.
  - **The race panel had no weekly-km bars to put a line over**, because `/api/race`
    had been typed since Phase 0 and never drawn. It is drawn now: the bars are
    kilometres run, the dashed step over them is what the plan asked for, and because
    both are kilometres they share the one y-axis the rules allow. The line continues
    past the last bar, which is the half of the chart that answers "does the curve
    reach January".
  - **Adherence is never shown without the efficacy line under it.** A 16 km run at the
    wrong effort is `done` exactly like a good one (T37), so the page says "29% over
    the last four" and "0 of the last 6 long runs held together to the end" in the same
    breath. On the owner's real data the second sentence is the one that matters.
  - **The opened week is in the URL** (`/plan?week=2026-09-21`), like every other
    view's state, which also makes it screenshot-able.
  - **The re-link control only offers activities the matcher would accept** — unclaimed
    ones within a day of the session. A manual link is read on the session's own day
    and the two either side (`analytics/plan._claim`), so a button offering Sunday's
    run for Wednesday's session would silently do nothing.
  - **T48 came out of this task.** Wiring the Ignore button showed it had never done
    anything; it is fixed in its own commit, and this one shows an ignored session as
    "Ignored" with "Count it again" beside it.
  - **Looked at on the owner's real activities with a stand-in plan**, because his
    calendar's address is a credential and is not in this checkout.
    `scripts/dev-standin-plan.py` writes a Higdon-shaped block into the throwaway copy
    and refuses to run anywhere else. Against his real runs that gives 29% adherence
    over four weeks, Sep 21 at 69%, a Wednesday run swapped for the Sep 23 ride, and
    the Sep 25 long run matched — every verdict traceable to an activity.
  - **Proved the corrections move the numbers**: ignoring the missed Monday in the week
    of Sep 21 took it from 3/5 at 69% to 3/4 at 82% and the rolling figure from 29% to
    32%; undoing it put both back.
  - 1,433 backend tests, 784 frontend tests across 68 files.

### T41 — Settings: the feed, and what it could not read
- **Goal:** the owner can connect a calendar, see what the parser made of it, and fix the
  events it could not read.
- **Files:** `frontend/src/features/settings/`, `frontend/src/api/queries/usePlan.ts`,
  `garmin_analytics/analytics/plan.py`, `garmin_analytics/api/schemas.py`,
  `frontend/src/api/schema.ts` (generated), `scripts/dev-standin-plan.py`,
  `tests/test_plan_api.py`.
- **Build:**
  - [x] paste the private ICS URL, see it masked, test it, remove it
  - [x] last sync, next sync, last error, and a Sync now that is disabled during a run
  - [x] the parse review list: every `unparsed` or `unsupported_rrule` session with its
    date and its original text, so a silent miss is a visible one
  - [x] the sessions the owner has re-linked or ignored by hand, and how to undo that
- **Notes:**
  - Where to find the URL belongs in the panel, not in a README: Google Calendar →
    Settings for that calendar → "Secret address in iCal format". The panel says so, and
    says in the same breath that it is a credential.
  - The parse review list is the honesty mechanism for T36. Without it, a session the
    parser dropped is simply absent from the adherence denominator and the number
    silently improves. It names each entry's date, its own title, and why it was
    refused — a repeat rule the stdlib subset will not guess at (D10), or no distance
    and no sport in the text at all.
  - **The address goes in through a password field and never comes back out.** Every
    reading of it on this page is the masked form the API returns; nothing in the view
    has ever held the real one.
  - **`/api/plan` gained `decisions`** — the manual links and ignores, with the day and
    title of each. They are the only part of the plan's judgement that is stored rather
    than recomputed (T34), so they are the only part that can go wrong and stay wrong;
    Settings lists them with an Undo.
  - **The plan joins the Sync panel's problem list.** `autoSyncProblems` checked
    `garmin` and `fitbit` only, so a feed that 404s during an automatic run said nothing
    anywhere. Google rotating the secret address is the failure this will actually hit.
  - **`scripts/dev-standin-plan.py` exists because the owner's calendar address is a
    credential** and is not in this checkout. It writes a Higdon-shaped block — plus
    two entries the parser is meant to refuse, so the review list has something in it —
    into the throwaway copy, and refuses to run against any other database.
  - 1,436 backend tests, 797 frontend tests across 69 files.

### T48 — An ignored session is actually ignored
- **Goal:** the second of the two decisions the owner is allowed to make does something.
- **Files:** `garmin_analytics/analytics/plan.py`, `garmin_analytics/api/schemas.py`,
  `frontend/src/api/schema.ts` (generated), `tests/test_plan_adherence.py`,
  `tests/test_plan_api.py`.
- **Build:**
  - [x] `judge_all` reads `plan_links` rows of type `ignored`, not only `manual`
  - [x] an ignored day leaves the adherence denominator, the way an optional one does
  - [x] the API says a session is ignored, so the view can show it as a decision rather
    than losing it silently
- **Notes:**
  - Found while building T40's re-link control. `set_link(..., ignore=True)` has always
    written the row and `_manual_links` has always selected `link_type = 'manual'`, so
    ignoring a session wrote a decision nothing ever read: the percentage did not move.
    T34's card says `manual` and `ignored` are both "things the owner said"; only one of
    them was.
  - **An ignored session must stay visible.** Dropping it from the response would make
    the denominator fall for no stated reason, which is the same silent improvement the
    parse review list exists to prevent (T41). It is reported with `ignored: true`
    beside its ordinary verdict.
  - **A day is ignored if any of its events is.** A day's events are one prescription
    written several times (D13), so there is no coherent half-ignored day; `collapse`
    takes the union.
  - Measured against the real copy with a stand-in plan loaded: ignoring the missed
    Friday long run in the week of 2026-09-28 took that week from 2 prescribed sessions
    at 23% to 1 at 100%, and undoing it put the 23% back.
  - 1,433 backend tests.

### T42 — Targets the plan actually asks for
- **Goal:** no number in this app that measures the owner against a target is a number
  an agent made up.
- **Files:** `garmin_analytics/config.py`, `garmin_analytics/analytics/plan.py`,
  `garmin_analytics/analytics/readiness.py`, `garmin_analytics/api/schemas.py`,
  `garmin_analytics/api/server.py`, `frontend/src/api/schema.ts` (generated),
  `tests/test_plan_adherence.py`, `tests/test_plan_api.py`, `tests/test_readiness.py`.
- **Build:**
  - [x] `TARGET_PEAK_CTL` and `TARGET_PEAK_WEEKLY_KM` deleted from `config.py`
  - [x] `plan.targets` grows a derived CTL target; `plan.load_per_km` prices a
    kilometre from the owner's own last 90 days of running
  - [x] `compute_race` takes both targets from `plan.race_targets`, and carries the
    `targets` block so a panel can label them derived
  - [x] every target on `/api/race` is nullable; with no calendar they are all null
  - [x] the two notes that compared volume and CTL to the constants now quote the
    plan's own peak, or say there is no plan to measure against
  - [x] `/api/config` loses its `targets` block; types regenerated
- **Notes:**
  - **The CTL target is arithmetic, not a guess.** CTL is a 42-day average of daily
    load, so a week held at the plan's peak settles at `peak_km × load_per_km / 7`.
    The only input that is not the calendar's is the price of a kilometre, and that is
    read from the owner's own running — which is what lets it be called derived.
  - **Measured on the real database** (a copy, 2026-10-08): 12.53 TRIMP/km over the
    last 90 days, and 12.62 over 28 — stable enough to price a plan with. His plan's
    35.7 km peak week therefore implies **CTL 63.9**, against the 75 that was invented
    and a current CTL of 19.2. The old 55 km/week would have implied 98.5.
  - **Deleting a target is the honest empty state.** With no calendar subscribed the
    panel gets `null` everywhere and one note saying so. The alternative — keeping a
    default "until the owner connects something" — is the bug this task exists to
    remove, in a quieter form.
  - **Proved end to end on the real data** by loading a stand-in Higdon-shaped feed
    into the throwaway copy: `/api/race` went from all-null to `weekly_km_target 44.1`,
    `ctl_target 78.9`, `+4.2 CTL/week needed`, with every number traceable to a session
    in the calendar. The owner's real feed is not in this checkout, so the stand-in's
    peak is not his 35.7.
  - Nothing in the frontend read either constant, so there is no visible change; the
    `/status` and `/settings` screenshots were taken to prove exactly that, and deleted.
  - 1,426 backend tests, 751 frontend tests.

### T34 — Schema v3: somewhere to put what was prescribed
- **Goal:** the database can hold a prescribed session, where it came from and which
  activity fulfilled it, without changing anything that already exists.
- **Files:** `garmin_analytics/db/schema.sql`, `garmin_analytics/db/store.py`,
  `tests/test_store.py`.
- **Build:**
  - [x] `plan_sources`, `plan_sessions`, `plan_links`
  - [x] `SCHEMA_VERSION` → 3, migration row `v3: the training plan`
  - [x] an existing database gains the tables in place, keeping its rows
- **Notes:**
  - **Three constraints carry the adherence maths, and each has its own test.**
    `UNIQUE (source_id, uid, recurrence_id)` is what lets one weekly rule hold a
    different prescription each week — keyed on `uid` alone, week 2 overwrites week 1.
    The partial `UNIQUE` on `plan_links.activity_id` stops one long run from satisfying
    both Thursday and Friday; partial, because `ignored` and `missed` links hold NULL
    and several may exist at once. `withdrawn_at` keeps a row whose series was deleted
    in the calendar, which is the only reason a finished week stays judged against what
    it actually prescribed.
  - `plan_links` stores decisions, not results. `auto` rows are the matcher's own output
    and are rewritten every run, so retyping an activity moves its match with it; only
    `manual` and `ignored` are things the owner said.
  - **Additive only.** No existing table, view or stored value changed, which is what
    makes the upgrade a `CREATE TABLE IF NOT EXISTS` and nothing else. The fingerprint
    in `PRAGMA user_version` moves with `SCHEMA_VERSION`, so an older database re-runs
    the script once and then stops.
  - Suite green at 1202 passed, 1 skipped, plus the six new tests.

### T35 — The calendar, read without trusting it
- **Goal:** the owner's training calendar becomes rows in `plan_sessions`, repeatably,
  with the feed's address never leaving the database in readable form.
- **Files:** `garmin_analytics/ingest/ics.py`, `garmin_analytics/ingest/plan_ics.py`,
  `garmin_analytics/cli.py`, `garmin_analytics/db/schema.sql`,
  `tests/test_ics.py`, `tests/test_plan_ics.py`, `tests/test_store.py`.
- **Build:**
  - [x] stdlib ICS reader: unfolding, quoted parameters, escaping, `TZID` / UTC /
    all-day, `DURATION`, and VALARM blocks skipped
  - [x] the D10 subset expanded; everything else flagged `unsupported_rrule`
  - [x] `EXDATE`, `RECURRENCE-ID` overrides and `STATUS:CANCELLED`
  - [x] fetch behind an injectable transport, `ETag` / `If-Modified-Since`, 304 as a
    successful no-op
  - [x] sessions that leave the feed are stamped `withdrawn_at`, never deleted; ones
    that come back are restored rather than duplicated
  - [x] `ga plan subscribe | sync | status | unsubscribe`
- **Notes:**
  - **A reset iCal address does not fail — it succeeds.** Google redirects a revoked
    private address to a sign-in page, which arrives as 200 with an HTML body and parses
    as zero sessions. In the UI that reads as "you have no plan", not "the link is
    dead", so the content type is checked and a non-calendar answer is an error that
    says the address was probably reset. This is the failure this feed will actually hit.
  - **Recurrence is expanded in wall-clock time, not absolute time.** Adding seven days
    to an aware datetime moves a 05:00 session to 04:00 the week the clocks change.
    `Asia/Qatar` has no daylight saving so it cannot bite the owner, but the app is
    meant to be run by other people, and a test pins it against `Europe/London`.
  - **An override keeps the recurrence id of the instance it replaced**, not of its new
    time. Using the new one leaves the original standing and prescribes the session
    twice — which is how a moved long run would have become two long runs.
  - **T34 shipped a bug that T35's test found.** `plan_sessions.source_id` was
    `NOT NULL ... ON DELETE CASCADE`, so unsubscribing from a calendar deleted every
    session it had ever prescribed — exactly the history `withdrawn_at` exists to keep.
    It is now nullable and `ON DELETE SET NULL`, with tests in both files.
  - **Only structural columns are written here.** `sport`, `kind` and the planned
    distances belong to T36, so a re-sync never discards a reading of the text. What a
    sync does reset is `parse_status`, to `pending`, which is what makes an edited
    description get re-read instead of keeping a stale target.
  - 50 new tests. Suite green at 1254 passed, 1 skipped.

### T36 — What the week actually asks for
- **Goal:** the calendar's prose becomes a prescription the matcher can judge, and
  whatever cannot be read says so instead of being guessed.
- **Files:** `garmin_analytics/plan/parse.py`, `tests/test_plan_parse.py`.
- **Build:**
  - [x] three layers, most trusted first: a `GA:` hint line, Monday's week note, the
    event's own title
  - [x] the week note split on `||` and then on sentences, each clause naming its days
  - [x] the owner's number beaten out of the Higdon number quoted beside it
  - [x] ranges kept as ranges; `rest`, `race` and `optional` recognised
  - [x] proved against all 115 events of the real calendar: 115 `ok`, 0 `unparsed`
- **Notes:**
  - **Every fixture in the test file is real text**, copied from the calendar on
    2026-10-08. Three of the bugs below are invisible to invented examples.
  - **The Higdon number sits in the same sentence as the owner's.** `target 18 km
    (Higdon prescribes 11.3 …)` and `Higdon says 7.2 km; club does 8-10 km` both hold two
    distances and one intention. Parentheticals and any clause opened by "Higdon
    says/prescribes" are removed before a distance is looked for, then cues — `target`,
    `club does`, `club runs`, `build toward` — pick the owner's.
  - **A day can hold two sports and the note is written per day.** Every Monday is an
    easy run *and* a gym session, so applying Monday's note to both gave the gym a
    7.2 km target. A note now speaks only for an event of its own sport, or one whose
    text named no sport. The asymmetry matters: a note that names no sport —
    `MON (today): 7.2 km easy.` never says "run" — does **not** get to claim an event
    that does. Reading "no sport stated" as "any sport" was the bug.
  - **One `||` segment can hold two sentences about different days.** `WED Lusail ride
    + SAT Olympic ride = Higdon cross-training. SUN = rest.` gave Wednesday and
    Saturday a rest day. Segments are split on a full stop followed by whitespace —
    and deliberately *not* on semicolons, because `Higdon says 7.2 km; club does
    8-10 km` is one thought and splitting it strands the club distance in a clause
    naming no day.
  - **Distances require an explicit unit.** The gym description is 2.5 KB holding
    `1x8-10 per leg` and `2x10-12`. A bare-number reader prescribes an 8-10 km run out
    of a set of step-ups.
  - **The Friday series' description is standing advice, not this week's target.** It
    names six distances, none of them current, and says so itself. A description is only
    consulted for a number when it is short and holds no `||`.
  - Where a week note and a titled event disagree — W10 says 18-20 km on Monday and
    14.5 km in the event title — **the note wins**, because that is where the owner
    deliberately sets targets above Higdon. Decided with the owner 2026-10-08.
  - **The live calendar found a bug three weeks of fixtures had not.** The real text
    puts the owner's own annotation and Higdon's beside each other —
    `target 16 km (recovery)  (Higdon prescribes 10K race - lower than you already
    run)` — and `kind` was read from the unstripped clause, so 25 December's recovery
    long run came out as a **race**, which weights five times its worth. A parenthetical
    naming Higdon is now removed before the kind is read; the owner's own is kept,
    because `(recovery)` and `(easy week)` are the only place a week's character is
    written down. Fixed 2026-10-08 against the live feed.
  - 41 tests. Suite green at 1352 passed, 1 skipped.

### T37 — Whether the training happened
- **Goal:** every prescribed day gets a verdict against what was actually done, and
  every week gets a number that means something.
- **Files:** `garmin_analytics/analytics/plan.py`, `tests/test_plan_adherence.py`.
- **Build:**
  - [x] a day's events collapsed into one prescription per sport (D13: more specific wins)
  - [x] verdicts: `done` · `short` · `missed` · `substituted` · `rest-kept` ·
    `rest-broken` · `upcoming`
  - [x] a ride on a run day is one substitution, not two failures
  - [x] weighted weekly adherence, planned against actual km, rolling 4-week
  - [x] run against the owner's real database and real calendar
- **Notes:**
  - **Three rules here came from the owner and all three invert the obvious code.**
    A day prescribes one session per sport, not one per calendar event — the club entry
    says where and when, the Higdon entry says how far, and they are one run described
    twice. Running further than prescribed is not a deviation, so there is no `over`
    verdict. And a ride on a run day is a substitution, not a missed run *plus* an
    unplanned ride.
  - **No sport-conversion ratio is applied, deliberately.** The rules that trade ridden
    kilometres for run ones are guesswork with arithmetic on top, and burying one here
    would put it invisibly into every weekly number. A substituted day is reported with
    both sports and left unscored. When it is settled, the honest axis is load, which is
    already computed per activity and is sport-neutral.
  - **Sessions are weighted.** The owner's weekly volume is nearly flat at 28-36 km
    while the long run climbs 14 → 20 km, so the long run is close to the whole
    stimulus and an unweighted percentage would hide losing it behind three easy
    sessions that happened.
  - **A rest day claims any activity on it**, which is how `rest-broken` is detected —
    so rest prescriptions are settled *after* every other one, or a rest day could take
    the activity a real session on the same date was waiting for. Found by test.
  - Exact-day matches are made for every day before any session reaches into a
    neighbour, and a session may never reach into a day the plan itself spent:
    otherwise Friday's long run gets credited with Saturday's prescribed ride.
  - A 5% shortfall is not a miss. GPS alone moves a long run by tens of metres.
  - **Proved on real data, not only on fixtures.** Against a read-only snapshot of the
    live database and the real calendar: Monday 5 Oct prescribed a 5 km easy run and the
    owner rode 25.4 km, which comes out as one `substituted` day rather than two
    failures. 29 tests; suite green at 1321 passed, 1 skipped.

### T38 — The plan, over HTTP
- **Goal:** the frontend can draw the plan and the week, and the owner can correct a
  match the matcher got wrong.
- **Files:** `garmin_analytics/api/server.py`, `garmin_analytics/api/schemas.py`,
  `garmin_analytics/analytics/plan.py`, `garmin_analytics/ingest/plan_ics.py`,
  `garmin_analytics/db/schema.sql`, `garmin_analytics/db/store.py`,
  `frontend/src/api/schema.ts` (generated), `tests/test_plan_api.py`.
- **Build:**
  - [x] `GET /api/plan`, `GET /api/plan/week?start=`
  - [x] `PUT`/`DELETE /api/plan/source` (address in, masked out), `POST /api/plan/sync`
  - [x] `PUT`/`DELETE /api/plan/sessions/{id}/link` — manual link, ignore, clear
  - [x] no calendar subscribed answers 200 with `subscribed: false`
  - [x] Pydantic models, `npm run gen:api`, regenerated types committed
- **Notes:**
  - **T35 and T36 were never actually joined.** The sync wrote `parse_status =
    'pending'` and nothing ever read it, so every stored session had a null sport and a
    null distance. `plan_ics.apply_parse` closes it and runs at the end of a sync. It is
    a separate function because the two fail differently: the fetch is network and
    credentials, this is only reading, and re-running it costs nothing.
  - **The week notes have to be indexed across every live session before any row can be
    parsed.** The note governing a Friday is written on the preceding Monday's event, so
    a row cannot be read by looking only at itself.
  - `collapse()` needed three columns the schema did not have — `optional`, `recurring`
    and `parse_source`. Added to `schema.sql` *and* to `ADDED_COLUMNS`, so a database
    created by an earlier build of v3 gains them instead of having to be thrown away.
  - **Only `manual` and `ignored` links are stored.** `auto` matches are recomputed on
    every read, so retyping an activity moves its match with it; storing them would
    freeze a judgement that is meant to follow the data.
  - An activity already linked elsewhere is a **409 naming the session that holds it**.
    The unique index would refuse it anyway, but "already linked to session 12" is more
    use than a constraint violation.
  - **Two test bugs worth remembering.** Fixtures were dated in December, and the
    endpoints judge against the real clock, so every session was `upcoming` and the week
    scored 100%; plan fixtures must sit in the past. And the sync route builds its own
    transport, so testing it needs `UrllibTransport` monkeypatched — otherwise the test
    reaches the network and 502s.
  - Types were generated against a scratch database on port 8831, which was stopped and
    deleted afterwards. The owner's container was not touched. `npm run typecheck` clean.
  - 20 tests; suite green at 1341 passed, 1 skipped.

### T39 — The calendar keeps itself current
- **Goal:** the plan follows the calendar on the same schedule as everything else,
  without anyone pressing anything.
- **Files:** `garmin_analytics/ingest/auto_sync.py`, `garmin_analytics/api/schemas.py`,
  `frontend/src/api/schema.ts` (generated), `tests/test_auto_sync.py`.
- **Build:**
  - [x] `sync_plan` beside `sync_garmin` and `sync_fitbit`; `run_once` totals 3
  - [x] `SOURCE_WATERMARKS` gains `plan`
  - [x] no calendar subscribed is a skip, a 304 is a good run that wrote nothing
  - [x] a feed error reports the owner-facing cause
- **Notes:**
  - **The plan runs last, and the order is load-bearing.** Adherence is judged against
    activities, so reading the calendar before Garmin has been pulled would score this
    morning's long run as missed until the next run six hours later. A test pins the
    order rather than trusting the tuple to stay as written.
  - **Adding a source 500s `/api/sync/auto` until the schema is widened.** `sources` is
    keyed by `Literal["garmin", "fitbit"]`, so the first run with a `plan` key failed
    response validation. Same shape as the `rate_limited` watermark status in T30: a
    value the model does not allow is a 500 on a route nobody touched. The Literal now
    carries a note to widen it.
  - A 304 is reported as "Training plan unchanged" rather than as silence, so Settings
    can tell "looked, nothing new" from "has not looked".
  - 1349 passed, 1 skipped; `npm run typecheck` clean.
