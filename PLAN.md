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
| 19 Data defects | S: `ready for review` | 5 / 7 |
| 20 Race prep | T: `open` | 3 / 4 |
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
| T68 | Activity page: answers first (plan, route, effort / volume), then the map beside the kilometres, one chart, the rest one click away. Run, cycle and strength sessions (each exercise against last time) | in review | — |
| T69 | Map: filters as chips, no empty native date pickers, Routes as a real control | todo | T65 |
| T70 | Plan: the sticky weekday header covers the top of the week above it; read the week as a column like Today | todo | — |
| T71 | Health: one big number per metric with a sparkline, detail on click | todo | T66 |
| T72 | One control style: the native selects and date inputs match the rest | todo | — |
| T73 | Card depth, the page and card contrast, and the text sizes on every page, not only Today | todo | — |

### Phase 19 — Data defects · Checkpoint S: `ready for review`

Seen on the real data on 2026-11-09. Each one shows a wrong or meaningless number.

| ID | Task | Status | Depends on |
|---|---|---|---|
| T74 | A ride's map draws a straight line across the bay. It was a recording gap, not a GPS jump: the watch paused for 28 minutes and resumed 7 km away. No line is drawn across a gap, on the activity page, the compare map and the cards | done | — |
| T75 | Trends shows "Average pace 15:08 /km, mixed sports". Pace only means something for one sport; it is a dash until a sport is chosen | done | — |
| T76 | Year over year shows "+14,153%" and "+16,767%" against a near-empty first year. No change is shown against a year with fewer than 12 activities | done | — |
| T86 | A gap on a ride is drawn dashed along the path your other rides took between its two ends, with the speed it implies and a note saying it is a guess and not in the totals. Step 1 of 3 | done | T74 |
| T87 | Mark the missing path yourself on the map when no other ride covers it, or the guess is wrong. Step 2 of 3 | todo | T86 |
| T88 | Optionally count an estimated stretch in the ride's totals, with its effect on heart rate, load and best efforts shown first. Step 3 of 3 | needs decision: count it at all? | T86 |
| T77 | Sleep: Garmin gives no sleep score, and some nights have no recording. Today says how many of the last seven nights were recorded and leaves a gap for each missing one. (Health still to do, with T71) | done | — |

### Phase 20 — Race prep · Checkpoint T: `open`

| ID | Task | Status | Depends on |
|---|---|---|---|
| T78 | Race-day pacing plan at `/race`: per-km splits that add up to a target (the finish range's fast, likely or slow end, or typed), a gentle first km, 5 s per turn, even or negative. Turns come from a course GPX in `<data dir>/courses/<race date>.gpx`. Flat: no hills | done | — |
| T79 | Taper check: the last weeks of planned running against the peak week, and where the plan as written leaves form on race morning. A popup on the race card | done | — |
| T80 | A missed or short long run says so on Today, with what it costs on race day (a rule of thumb, usually seconds), and what the next one is | done | — |
| T81 | A post-race page: the result against the projection, then a suggested recovery block | todo | — |

### Phase 21 — Platform · Checkpoint U: `open`

| ID | Task | Status | Depends on |
|---|---|---|---|
| T82 | Re-clustering in the background, not in the request: about 13 s for 500 tracks and it grows faster than linearly | todo | — |
| T83 | Say when a sync source keeps failing or the Garmin login lapses | todo | — |
| T84 | A backup button in Settings: one file with the database and the raw archive | todo | — |
| T85 | A weekly digest from the six-hourly sync: the week against the plan, in a few lines | todo | — |

### Phase 22 — Weather and wind · Checkpoint V: `ready for review`

Source: **Open-Meteo** (D26), no key, hourly, free for personal use. Fetched once per
activity, stored, never re-asked. Steps run in order, one branch (`weather`).

| ID | Task | Status | Depends on |
|---|---|---|---|
| T89 | Store it: an `activity_weather` table (temperature, feels-like, humidity, dew point, wind speed and direction, gusts, rain, cloud) averaged over the activity's hours at its start point, and an Open-Meteo client behind a fake-able transport, with tests | done | — |
| T90 | Fetch it: backfill every outdoor activity with GPS in one batch, then each new activity in the six-hourly sync. Recent hours use the forecast API's past days, older ones the archive; a failure is recorded and retried, never raised | done | T89 |
| T91 | Wind against the route: the headwind or tailwind share of each segment (heading against the wind), and an activity total | done | T89 |
| T92 | The activity page: a weather chip (31 °C, humid, 14 km/h from the NW) with the working in a popup | done | T90 |
| T93 | On the map: a wind arrow and weather readout, and "Headwind" as a fifth colour-by with its own legend | done | T91, T92 |
| T94 | Analytics: pace and heart rate against heat and dew point, then a weather-adjusted pace for comparing runs. Later; ask the owner first | todo | T90 |

### Open decisions

| ID | Question | Status |
|---|---|---|
| D23 | Does Trends fold into Train and Body, or stay its own page? | open |
| D24 | Is there a Doha half-marathon course GPX to build the pacing plan from? | answered: no official file; one was traced from the published course map (approximate, 30 to 80 m, 21.06 km) and is in `courses/`. Use the organiser's own if one is published |
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
| D26 | **Weather comes from Open-Meteo.** Free for personal use, no key, hourly history to 1940 and the same fields as a forecast. Stored per activity so the app never depends on it being up. klimat.app could not be verified. | 2026-11-12 |

### Parked (not planned; ask the owner before starting)

- **Per-set gym detail**: each set's weight and reps, order and rest. Needs a new Garmin
  fetch of `/activity-service/activity/{id}/exerciseSets` in `ingest/` and a backfill.
- **`indoor_cardio` and `hiit` become `other`** in `activities` (`ingest/normalize.py`
  `TYPE_MAP`). The original type survives only in the raw payload.
- **Strava import** for gaps Garmin leaves.
- **A brute-force lockout on `APP_PASSWORD`**: login is off by the owner's choice (D2).
- **Course, heat and non-running load in the race forecast.**
