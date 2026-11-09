# Plan

What is next, and what is left after the MVP.

## The MVP is what is built

Everything done up to 2026-11-09 is the MVP: phases 0 to 15, all approved, recorded in
[`PLAN-HISTORY.md`](PLAN-HISTORY.md). It is a self-hosted analytics app over one person's
Garmin history, and it already does this:

- **Syncs itself** from Garmin, the Google Health scale and the training calendar, every six hours.
- **Today:** the day's session, readiness and sleep, the race countdown with a finish range and race-morning form, this week and last week by day, and the weeks of kilometres against the plan.
- **Activities:** cards and a table, with maps, HR zones, splits, gym sessions, editing that a sync never overwrites, and comparing two to five.
- **Routes and the map:** loops clustered by ground covered and timed by the lap, segment analysis, a lifetime heatmap.
- **Health and Trends:** sleep, HRV, resting HR, Body Battery, weight and body composition back to 2014, records, streaks and year over year.
- **Plan:** the calendar read and judged, session by session.
- **Gear:** mileage, retirement and bulk reassign.

The history file also holds the **Rules**, **How to work on a task** and every earlier task
card. Those rules still apply. Read them before changing anything.

This file is the tracker. Agents pick tasks from the tables below and update them in the
same commit as the work; the owner reads them to see what is done. `git log -p PLAN.md`
is the history.

**Post-MVP.** Every phase below is new work on top of a working app. None of it blocks using
the app, and the order is the owner's to change.

**Versions.** The MVP is `v0.1.0`. A release is cut whenever the owner says, using the
steps under Versions in `CONTRIBUTING.md`, and each phase that ships adds a changelog entry.

**One branch per task or phase**, named for the work, from `master`, merged and deleted
when approved. Work one thing at a time: the box has two CPUs.

## The date that matters

**Doha Half Marathon, Friday 15 January 2027, 07:35.** On 9 Nov 2026 that is 67 days away.
The race card projects **3:25 to 3:33** and warns that fitness falls from 30 to 18 at the
current pace: only about a quarter of the plan's kilometres were run in the last four
weeks. Anything that helps the training happen comes before anything that makes the app
nicer.

## Suggested order

1. **Phase 16**: tidy and ship what is built.
2. **Phase 19**: the data defects. Small, and each one makes a number wrong.
3. **Phase 20**: race prep. Has a deadline.
4. **Phases 17 and 18**: the nav and the page redesign. Big, no deadline.
5. **Phase 21**: platform.

## Status

**Task statuses:** `todo` · `in progress (<who>, <date>)` · `done` · `blocked: <why>` ·
`needs decision: <question>`

**Checkpoint statuses:** `open` · `ready for review` · `changes requested` · `approved`

| Phase | Checkpoint | Done |
|---|---|---|
| 16 Tidy and ship | P: `ready for review` | 3 / 3 |
| 17 The nav and the pages it points to | Q: `open` | 0 / 4 |
| 18 Page redesign | R: `open` | 0 / 6 |
| 19 Data defects | S: `open` | 1 / 4 |
| 20 Race prep | T: `open` | 0 / 4 |
| 21 Platform | U: `open` | 0 / 4 |

### Phase 16 — Tidy and ship · Checkpoint P: `ready for review`

| ID | Task | Status | Depends on |
|---|---|---|---|
| T61 | Mark checkpoints L to O approved in `PLAN-HISTORY.md` (the owner reviewed them) | done | — |
| T62 | Rebuild the main container from `master` and verify it on the real data | done | — |
| T63 | The plan strip logs "two children with the same key" (dates 2026-11-09, 2026-11-13): fix the key | done | — |

### Phase 17 — The nav and the pages it points to · Checkpoint Q: `open`

Today replaced Status. The nav is still Today, Plan, Activities, Map, Health, Trends. The
design groups it as **Today, Train, Activities, Places, Body**, so there is less to scan.

| ID | Task | Status | Depends on |
|---|---|---|---|
| T64 | Train: the plan, training load, the race and the performance trends in one page | todo | — |
| T65 | Places: the map and the routes in one page, routes as a side sheet on the map | todo | — |
| T66 | Body: health, sleep and weight in one page | todo | — |
| T67 | The nav, the routes and their redirects (`/status` stays working); Trends folds into Train and Body | todo | T64, T65, T66 |

### Phase 18 — Page redesign · Checkpoint R: `open`

The brief is ease of retrieval: the answer first, the working one click away, and no wall
of information. Today is the pattern: a few numbers, then what it means.

| ID | Task | Status | Depends on |
|---|---|---|---|
| T68 | Activity page, map first: a scrub bar with a live readout, one combined chart, four stats, the rest collapsed. The metric toggle must not sit under the route | todo | — |
| T69 | Map: filters as chips, no empty native date pickers, Routes as a real control | todo | T65 |
| T70 | Plan: the sticky weekday header covers the top of the week above it; read the week as a column like Today | todo | — |
| T71 | Health: one big number per metric with a sparkline, detail on click | todo | T66 |
| T72 | One control style: the native selects and date inputs match the rest | todo | — |
| T73 | Card depth, the page and card contrast, and the text sizes on every page, not only Today | todo | — |

### Phase 19 — Data defects · Checkpoint S: `open`

Seen on the real data on 2026-11-09. Each one shows a wrong or meaningless number.

| ID | Task | Status | Depends on |
|---|---|---|---|
| T74 | A ride's map draws a straight line across the bay. It was a recording gap, not a GPS jump: the watch paused for 28 minutes and resumed 7 km away. No line is drawn across a gap, on the activity page, the compare map and the cards | done | — |
| T75 | Trends shows "Average pace 15:08 /km, mixed sports". Pace only means something for one sport; show it for the chosen type or not at all | todo | — |
| T76 | Year over year shows "+14,153%" and "+16,767%" against a near-empty first year. Show nothing when the base is too small to mean anything | todo | — |
| T77 | Sleep: Garmin gives no sleep score, and some nights have no recording. Say so where sleep is shown, and say which nights are missing | todo | — |

### Phase 20 — Race prep · Checkpoint T: `open`

| ID | Task | Status | Depends on |
|---|---|---|---|
| T78 | Race-day pacing plan: per-km splits from the projected time, even or slightly negative. Hill-aware if a course GPX can be had | needs decision: is a Doha course GPX available? | — |
| T79 | Taper check: planned volume against form, and what race morning looks like, shown as the taper is planned | todo | — |
| T80 | A missed long run says so on Today, with what it costs the projection | todo | — |
| T81 | A post-race page: the result against the projection, then a suggested recovery block | todo | — |

### Phase 21 — Platform · Checkpoint U: `open`

| ID | Task | Status | Depends on |
|---|---|---|---|
| T82 | Re-clustering in the background, not in the request: about 13 s for 500 tracks and it grows faster than linearly | todo | — |
| T83 | Say when a sync source keeps failing or the Garmin login lapses | todo | — |
| T84 | A backup button in Settings: one file with the database and the raw archive | todo | — |
| T85 | A weekly digest from the six-hourly sync: the week against the plan, in a few lines | todo | — |

### Open decisions

| ID | Question | Status |
|---|---|---|
| D23 | Does Trends fold into Train and Body, or stay its own page? | open |
| D24 | Is there a Doha half-marathon course GPX to build the pacing plan from? | open |
| D25 | Should the page changes reach the old pages at once (T73), or only as each page is redone? | open |

### Decided

Numbering continues from `PLAN-HISTORY.md`, which ends at D16.

| ID | Decision | Date |
|---|---|---|
| D17 | **Light is the default theme.** A browser with nothing stored gets light, not what the OS says. A saved choice, including System, wins. | 2026-11-09 |
| D18 | **The page is capped at 1480 px, and the root font follows the window between 15 and 17 px.** A large display gets margin, not bigger cards. Windows under 52 rem tall use compact spacing so a laptop fits the Today cards without scrolling. | 2026-11-09 |
| D19 | **Explanations open in a popup, not in the card.** `InfoPopover` is the pattern: the answer stays on the page and the working is one click away. Content that is the page (the load charts, the gym detail, a form) still expands in place. | 2026-11-09 |
| D20 | **Today replaces Status.** The route stays `/status`; the nav says Today. Load and gym sit behind a toggle until a Train page exists. | 2026-11-09 |
| D21 | **The race forecast prices the plan's kilometres at the owner's own load per km,** and judges the likely line by the kilometres run over the last 28 days against the plan, not by the plan's session score. A fresh race-morning form is a warning when fitness is falling. The finish range always takes in the Riegel exponent band; the fitness and form adjustments are rules of thumb and are returned apart from the raw range. | 2026-11-09 |
| D22 | **The analytics cache version carries today's date,** so answers about today (the load curve, the race countdown) recompute after midnight and not at the next write. | 2026-11-09 |

### Parked (not planned; ask the owner before starting)

- **Per-set gym detail**: each set's weight and reps, order and rest. Needs a new Garmin
  fetch of `/activity-service/activity/{id}/exerciseSets` in `ingest/` and a backfill.
- **`indoor_cardio` and `hiit` become `other`** in `activities` (`ingest/normalize.py`
  `TYPE_MAP`). The original type survives only in the raw payload.
- **Strava import** for gaps Garmin leaves.
- **A brute-force lockout on `APP_PASSWORD`**: login is off by the owner's choice (D2).
- **Course, heat and non-running load in the race forecast.**
