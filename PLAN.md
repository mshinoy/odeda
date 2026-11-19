# Plan

What is next, and what is left after the MVP.

## The MVP is what is built

Everything done up to 2026-11-09 is the MVP: phases 0 to 15, all approved, recorded in
[`docs/history/PLAN-HISTORY.md`](docs/history/PLAN-HISTORY.md). It is a self-hosted analytics app over one person's
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

## How work moves

Nothing is built without a row here. Every piece of work goes through the same four places:

1. **Idea → [`FUTURE.md`](FUTURE.md).** Anything not yet decided: the *why*, what it would take,
   and what would trigger building it. Nothing here is scheduled.
2. **Decided → this file.** When the owner says "build this", it becomes a phase with task rows
   (ID, task, status, depends on) and a checkpoint. The idea leaves a pointer in FUTURE.md and
   its detail is not copied. A piece too big for a table (a redesign, a launch) gets its own
   plan file, like [`docs/history/REDESIGN.md`](docs/history/REDESIGN.md), linked from the phase, with `- [ ]` tick boxes
   for its steps; this file still has one row per step, and the row's status is the truth.
3. **Working → keep the row current.** One branch per task, from `main`. The status goes to
   `in progress (<branch>, <date>)` when it starts, and to `done` in the same commit as the work.
   Update the phase count in the status table. A question for the owner is a row under Open
   decisions; a choice made is a row under Decided.
4. **Shipped → the record.** A release adds a [`CHANGELOG.md`](CHANGELOG.md) entry. Finished
   phases move to [`docs/history/PLAN-HISTORY.md`](docs/history/PLAN-HISTORY.md) when this file gets long. Work that is
   dropped or put off goes back to FUTURE.md (or Parked, below) with the reason.

**The rule: whenever code is touched, `PLAN.md` is touched in the same commit.** The task's row
changes status (`in progress`, then `done`), the phase count follows, and the snapshot at the top
changes when something the owner would notice has changed. A commit with no row to update means
there was no task: add the row first. A git hook enforces this (`.githooks/pre-commit`; enable it
once per clone with `git config core.hooksPath .githooks`; `SKIP_PLAN_CHECK=1` for a commit that
changes no behaviour). Pure documentation commits need nothing extra.

If the owner asks for something directly, add its row first, in the same commit as the work.
A task has one home: T81, T85 and T94 are tasks here, and FUTURE.md only points to them.
Verify the snapshot at the top of this file whenever a phase changes.


This file is the tracker. Agents pick tasks from the tables below and update them in the
same commit as the work; the owner reads them to see what is done. `git log -p PLAN.md`
is the history.

**Post-MVP.** Every phase below is new work on top of a working app. None of it blocks using
the app, and the order is the owner's to change.

**Versions.** The MVP is `v0.1.0`. A release is cut whenever the owner says, using the
steps under Versions in `CONTRIBUTING.md`, and each phase that ships adds a changelog entry.

**One branch per task or phase**, named for the work, from `main`, merged and deleted
when approved. Work one thing at a time: the box has two CPUs.

## Where things stand (16 Nov 2026)

On `main` and in the app (checkpoints P, S, V, W, X, Y and Z approved 2026-11-16):
- **MVP** (`v0.1.0`, phases 0 to 15), the tidy-up (16), and the data defects (19; T87 is left).
- **Race prep** (20): the pacing plan, taper check and missed-long-run warning. The post-race page is not built.
- **Weather and wind** (22): stored, shown on the activity page and map. The analytics (T94) are not built.
- **Plan rules** (23): Higdon's number is the day's target; a ride pays off part of a missed long run.
- **Activity page** (18's T68, 25): run, cycle and muscles pages, laps, workout steps, blue-to-red routes.
- **Flyover and video export** (24): a 3D flyover of an activity and an MP4 export of it.
- **Page redesign** (18, partly): Map and Routes as one page, Health and Trends as cards, Settings as cards. Race, Compare and Gear are restyled too (T73), and the Map filters still use native selects and date pickers (T69).
- **Train** (17): one nav entry, four tabs: Plan, Race, Load (moved from Today) and Trends. The nav is Today, Train, Activities, Map, Health (D34).
- **The Plan page** (26): it steers (verdict, this week, the road to race day), a session can be edited, and a plan can be uploaded.

Not started: platform (21), the post-race page (T81). Open questions for the owner: D25 and D32. Direction beyond that
is in [`FUTURE.md`](FUTURE.md): publish as a self-hosted open-source project first (D29).

Nothing is in progress on a branch. `main` is `v0.3.0` once the release pull request is merged (cut 19 Nov 2026); the last tag is `v0.2.0` (16 Nov 2026).

## The date that matters

**Doha Half Marathon, Friday 15 January 2027, 07:35.** On 15 Nov 2026 that is 61 days away.
As of 9 Nov the race card projects **3:25 to 3:33** and warns that fitness falls from 30 to 18 at the
current pace: only about a quarter of the plan's kilometres were run in the last four
weeks. Anything that helps the training happen comes before anything that makes the app
nicer.

## Suggested order

1. **Phase 16**: tidy and ship what is built. *Done.*
2. **Phase 19**: the data defects. Small, and each one makes a number wrong. *Five of six done (T88 dropped); T87 is left.*
3. **Phase 20**: race prep. Has a deadline. *Three of four done.*
4. **Phases 17 and 18**: the nav and the page redesign. Big, no deadline. *Under way: see docs/history/REDESIGN.md.*
5. **Phase 21**: platform. *Not started.*

## Status

**Task statuses:** `todo` · `in progress (<who>, <date>)` · `done` · `blocked: <why>` ·
`needs decision: <question>`

**Checkpoint statuses:** `open` · `ready for review` · `changes requested` · `approved`

| Phase | Checkpoint | Done |
|---|---|---|
| 16 Tidy and ship | P: `approved` | 3 / 3 |
| 17 The nav and the pages it points to | Q: `ready for review` | 6 / 6 |
| 18 Page redesign | R: `open` | 2 / 6 |
| 19 Data defects | S: `approved` | 5 / 6 (T88 dropped) |
| 20 Race prep | T: `open` | 3 / 4 |
| 21 Platform | U: `open` | 0 / 4 |
| 22 Weather and wind | V: `approved` | 5 / 6 |
| 23 Plan rules | W: `approved` | 2 / 2 |
| 24 Flyover and video export | X: `approved` | 3 / 3 |
| 25 Activity page additions and dev setup | Y: `approved` | 4 / 4 |
| 26 The Plan page: steer, and change the plan | Z: `approved` | 8 / 8 |
| 27 Ready to publish: the README and docs | AA: `open` | 12 / 13 |

### Phase 16 — Tidy and ship · Checkpoint P: `approved`

| ID | Task | Status | Depends on |
|---|---|---|---|
| T61 | Mark checkpoints L to O approved in `docs/history/PLAN-HISTORY.md` (the owner reviewed them) | done | — |
| T62 | Rebuild the main container from `master` and verify it on the real data | done | — |
| T63 | The plan strip logs "two children with the same key" (dates 2026-11-09, 2026-11-13): fix the key | done | — |

### Phase 17 — The nav and the pages it points to · Checkpoint Q: `ready for review`

Today replaced Status. The nav is still Today, Plan, Activities, Map, Health, Trends. The
design groups it as **Today, Train, Activities, Places, Body**, so there is less to scan.

| ID | Task | Status | Depends on |
|---|---|---|---|
| T64 | Train: the plan, training load, the race and the performance trends in one page. Built as one nav entry with four tabs at `/train`: Plan, Race, Load (training load and gym, moved from Today) and Trends (all five Trends cards) | done (2026-11-16) | — |
| T65 | Places: the map and the routes in one page, routes as a side sheet on the map. It keeps the name **Map** (D34). The Map and Routes page is built (routes list on the right, the chosen route on the map, heat map when none is chosen) | done (merged 2026-11-15; the Places nav entry is T67) | — |
| T66 | Body: health, sleep and weight in one page. Decided 2026-11-16: it stays as **Health**. The page already holds Recovery (sleep, HRV, resting heart rate, Body Battery, readiness), Body (weight and body composition) and Activity level | done (nothing to build; D34) | — |
| T67 | The nav, the routes and their redirects (`/status` stays working); Trends folds into Train. The nav is now Today, Train, Activities, Map, Health. `/plan`, `/race` and `/trends` redirect to `/train`, `/train/race` and `/train/trends`, keeping their query | done (2026-11-16) | T64, T65, T66 |
| T112 | The Load tab on Train in the card style: Training load and Gym this week each a card with a question (they were bare panels moved from Today) | done (2026-11-16) | T64 |
| T113 | The Gear page in the card style: one Gear card holding the add and retired controls and the items, then the Default gear card | done (2026-11-16) | T73 |

### Phase 18 — Page redesign · Checkpoint R: `open`

The brief is ease of retrieval: the answer first, the working one click away, and no wall
of information. Today is the pattern: a few numbers, then what it means.

The plan for Map, Routes, Health and Trends is [`docs/history/REDESIGN.md`](docs/history/REDESIGN.md). Those four were
merged on 2026-11-15; Settings and the Plan page followed in Phase 26.

| ID | Task | Status | Depends on |
|---|---|---|---|
| T68 | Activity page: answers first (plan, route, effort / volume), then the map beside the kilometres, one chart, the rest one click away. Run, cycle and strength sessions (each exercise against last time) | in review | — |
| T69 | Map: filters as chips, no empty native date pickers, Routes as a real control | in progress (the Map page is merged; its filters still use native selects and date pickers) | T65 |
| T70 | Plan: the sticky weekday header covers the top of the week above it; read the week as a column like Today. Superseded by T105 and T107, which replace the grid | todo | — |
| T71 | Health: one big number per metric with a sparkline, detail on click. Built as three cards (Recovery, Body, Activity level) with the last reading when today's has not synced | done (merged 2026-11-15) | T66 |
| T72 | One control style: the native selects and date inputs match the rest | todo | — |
| T73 | Card depth, the page and card contrast, and the text sizes on every page, not only Today. Done so far: Today, Activities, Map, Health, Trends (five cards), Plan and Settings. Race, Compare and Gear restyled and merged 2026-11-16 | done | — |

### Phase 19 — Data defects · Checkpoint S: `approved`

Approved 2026-11-16 for what is done. T87 stays open and is picked up on its own; T88 is dropped (D33).

Seen on the real data on 2026-11-09. Each one shows a wrong or meaningless number.

| ID | Task | Status | Depends on |
|---|---|---|---|
| T74 | A ride's map draws a straight line across the bay. It was a recording gap, not a GPS jump: the watch paused for 28 minutes and resumed 7 km away. No line is drawn across a gap, on the activity page, the compare map and the cards | done | — |
| T75 | Trends shows "Average pace 15:08 /km, mixed sports". Pace only means something for one sport; it is a dash until a sport is chosen | done | — |
| T76 | Year over year shows "+14,153%" and "+16,767%" against a near-empty first year. No change is shown against a year with fewer than 12 activities | done | — |
| T86 | A gap on a ride is drawn dashed along the path your other rides took between its two ends, with the speed it implies and a note saying it is a guess and not in the totals. Step 1 of 3 | done | T74 |
| T87 | Mark the missing path yourself on the map when no other ride covers it, or the guess is wrong. Step 2 of 3 | todo | T86 |
| T88 | Optionally count an estimated stretch in the ride's totals, with its effect on heart rate, load and best efforts shown first. Step 3 of 3 | dropped: decided 2026-11-15, totals use the recorded data as is (D33). Snapping to roads is an idea in `FUTURE.md` | T86 |
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

### Phase 22 — Weather and wind · Checkpoint V: `approved`

Approved 2026-11-16 for what is done. T94 stays open and waits for the owner.

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

### Phase 23 — Plan rules · Checkpoint W: `approved`

Merged 2026-11-14. Recorded here because the plan's numbers changed.

| ID | Task | Status | Depends on |
|---|---|---|---|
| T95 | While a named plan (Higdon's) is on, its number is the day's target, over the club's and the owner's own; a `GA:` hint, an event stating its own distance, and a race still win (D27) | done | — |
| T96 | A ride on a long-run day pays off part of a missed long run | done | T80 |

### Phase 24 — Flyover and video export · Checkpoint X: `approved`

Merged 2026-11-14 and 2026-11-15. Ideas not built are in `FUTURE.md`.

| ID | Task | Status | Depends on |
|---|---|---|---|
| T97 | A 3D flyover of an activity (drone shot that swoops to follow, route shown once crossed) with a replay readout of distance, speed and heart rate, up to 25x | done | — |
| T98 | Mapbox Standard as the base map, with its 3D buildings and a satellite choice (D28) | done | — |
| T99 | Export the flyover as an MP4: length picker, 24 fps, several maps drawing frames at once, encoding while drawing, hardware encoding where available. About 38 s for a 60 s HD vertical video | done | T97, T98 |

### Phase 25 — Activity page additions and dev setup · Checkpoint Y: `approved`

Merged 2026-11-12. Extends the activity page redesign (T68).

| ID | Task | Status | Depends on |
|---|---|---|---|
| T100 | Laps: a structured workout's intervals, as the watch timed them | done | T68 |
| T101 | Workouts: every step against its plan, and steps for workouts without rests; adherence to the plan | done | T100 |
| T102 | Routes are coloured blue to red, not shades of one blue | done | — |
| T103 | Dev: Vite allows tailnet hosts, and api-dev's port is published for a built UI | done | — |

### Phase 26 — The Plan page: steer, and change the plan · Checkpoint Z: `approved`

The page's job is one question: **will this plan get me to the Doha Half on 15 Jan 2027 in
shape, and what do I do this week to stay on it?** Today it is a 22-week grid that reports on
the past. It should steer, and it should let the owner change the plan, or replace it with an
uploaded one, without leaving the page.

How the plan works now, because it decides how change can work: the plan is a Google
Calendar read over a private iCal address (`ingest/plan_ics.py`). The app never writes to
it. Each session is a `plan_sessions` row keyed by calendar `uid` and `recurrence_id`; a
session that leaves the feed is stamped `withdrawn_at` and kept, so a finished week is always
judged against what was asked at the time. So:

- **Edits live in the app, on top of the calendar**, in their own table that a sync never
  overwrites (the same idea as activity edits). The calendar stays as it is.
- **An uploaded plan is a second kind of source** next to the subscribed address. It takes
  over from a chosen day; earlier weeks keep the plan they were judged against.

Order: T104 first (everything on the page reads it), then the page (T105 to T107), then the
change area (T108 to T110), then verification (T111). One branch per task, from `main`.

| ID | Task | Status | Depends on |
|---|---|---|---|
| T104 | The steering answer, `GET /api/plan/steer`: weeks to race, ahead / level / behind (kilometres run over the last 28 days against the plan, as the race forecast does, D21), this week's key session, and at most two things at risk (a skipped long run, a run of missed days), each with one plain suggestion | done | — |
| T105 | The Plan page, top: the verdict card (one sentence plus adherence, peak week, fitness it implies), then **This week** with the seven days large and readable, then a lighter **Next week** | done | T104 |
| T106 | The road to race day: planned weekly kilometres as a line from now to race day (build, peak, taper), finished weeks filled in, the race-day projection at the end | done | T104 |
| T107 | History: past weeks as one compact row each (the week's date, a bar of done against planned, km, a strip of seven dots for the days). Opening a row shows the week's detail with Link, Ignore and "Let the matcher decide" as today | done | T105 |
| T108 | Change a session: move it to another day, change its distance, skip it, or add a session of your own. Kept in a `plan_edits` table, shown as "edited", never overwritten by a sync, and one click to undo | done | — |
| T109 | Upload a plan: an `.ics` file or a CSV (`date, title, distance`) becomes a new plan source. A preview shows what it will add and from which day before anything changes. `POST /api/plan/upload` | done | D30, D31 |
| T110 | A **Change the plan** area on the Plan page: Upload, Edit a week, and which source is live. Settings keeps the calendar address and the plan start date | done | T108, T109 |
| T111 | Verify on the real data (the plan, the race countdown, an uploaded test plan removed afterwards), tests for each rule, then rebuild prod | done (on prod 2026-11-15; an upload was previewed on the real data, not applied) | T104 to T110 |

### Phase 27 — Ready to publish: the README and docs · Checkpoint AA: `open`

The README was written for someone who already knew the project and was out of date (old nav, no
Train page, no screenshots). It is now a short front page; the detail moved to `docs/`. First-run
ideas are in `FUTURE.md` section 15.

| ID | Task | Status | Depends on |
|---|---|---|---|
| T114 | Rewrite `README.md` as a short front page (what you get per page, the quickstart through Settings, how it works, honest limits) and move the detail to `docs/` (features, getting your data in, configuration, architecture, honest limits) with no content dropped | done (2026-11-16) | — |
| T115 | Screenshots for the README: Today, Train, Map, an activity, a gym session and Health, taken from the demo instance (synthetic data, nothing personal) into `docs/img/`; the README shows them | done (2026-11-17) | T122 |
| T116 | A faster first run (`FUTURE.md` section 15, ideas 1 and 2): a Basics card in Settings for the time zone and the heart-rate limits (saved in the database, `.env` stays the default, a heart-rate change recomputes the stored load), a Password card (choose or change it, needs the current one), and a first-run checklist on Today while there are no activities | done (2026-11-16; on dev, prod not rebuilt) | T114 |
| T117 | Tidy the repo root (`FUTURE.md` publishing step 3): the history documents (`PLAN-HISTORY`, `DECISIONS`, `REVIEW-2`, `SPEC`, `REDESIGN`) move to `docs/history/`, the Google Health setup guide to `docs/google-health-setup.md`; every link and mention updated, no content changed. The root keeps the README, `PLAN.md`, `FUTURE.md`, `CHANGELOG.md`, `CONTRIBUTING.md` and the licence | done (2026-11-17) | T114 |
| T118 | Scrub personal detail from the tree (`FUTURE.md` publishing step 2): the real Garmin activity IDs (12, replaced by fake ones in the same order) and the neighbourhood and venue names tied to the owner\'s own routes, in the history documents and in test fixtures. Left in place on purpose: the club and race names in the calendar fixtures, the synthetic seed landmarks, and the default heart rates. The real GPS coordinates in seven test files are not done | done (2026-11-17) | T117 |
| T119 | A bug-report issue template (`FUTURE.md` publishing step 9): asks for what happened, the output of `doctor`, and how Garmin was signed in to. Blank issues stay on, so questions and ideas still work. CI (step 8) is deferred until the repository is public and takes pull requests | done (2026-11-17) | T118 |
| T120 | Rename the project to **Odeda** (Malayalam, \"run, da!\"; `FUTURE.md` section 13): the Python package (`garmin_analytics` to `odeda`), the command (`odeda`), the image and container names, the UI title, the licence holder, the README and docs. **Kept on purpose** so installs keep working: the Docker volume name `garmin-analytics-data`, the `GA_` settings prefix, the `ga_session` cookie, the `~/.garminconnect` folder, and the old `~/.local/share/garmin-analytics` folder when it already holds data. History documents and old changelog entries keep the old name. The GitHub repository is renamed to `odeda` too | done (2026-11-17; on dev and prod, repository renamed) | T119 |
| T121 | Sharpen the README opening around the settled positioning: analytics for athletes who follow a plan, judged against the plan they already have; not a coach. Adds what the name means (with the Malayalam spelling and a pronunciation) and three differences (the plan, the routes, owning the data) | done (2026-11-17) | T120 |
| T122 | A realistic demo instance for screenshots and a later hosted demo: the seeder gives every strength session real exercises, sets, reps and weights (its own random source, so the rest of the history is unchanged) and makes the Sundays one and three weeks before the end outdoor rides on a known route; `scripts/demo-plan.py` loads a neutral half-marathon plan (Doha, 15 Jan 2027) through the ordinary plan upload. The instance runs as the container `odeda-demo` on `127.0.0.1:8002` with its own volume `odeda-demo-data`, backed up in `~/garmin-work/backups/demo/` | done (2026-11-17) | T120 |
| T123 | The demo uses real tracks instead of generated squiggles: `odeda/seed/real_routes.json` holds twelve recorded routes (runs along the Lusail promenade, the Corniche and West Bay; rides to Lusail and Aamal), exported from a live install with anything within 2 km of the owner's home dropped. The seeder lays its synthetic runs onto them. Demo instance reseeded and the README screenshots retaken | done (2026-11-18) | T122 |
| T124 | CI on GitHub: `.github/workflows/ci.yml` runs the backend tests, the frontend type check, lint, tests and build, a Docker build and a gitleaks scan on every pull request. Free once the repository is public; nothing to deploy and no secrets | done (2026-11-19) | T123 |
| T125 | Demo mode: `GA_DEMO=1` makes an instance read-only. A middleware refuses every non-read request under `/api/` with a 403 and a plain reason (by method, so routes added later are covered; the plan-upload preview, which only reads, stays open). No sign-in, `demo` on `/api/config`, and a banner on every page. The step before hosting a public demo | done (2026-11-19) | T124 |

### Open decisions

| ID | Question | Status |
|---|---|---|
| D23 | Does Trends fold into Train and Body, or stay its own page? | answered 2026-11-16: it folds into Train as a tab; there is no Body page (D34) |
| D24 | Is there a Doha half-marathon course GPX to build the pacing plan from? | answered: no official file; one was traced from the published course map (approximate, 30 to 80 m, 21.06 km) and is in `courses/`. Use the organiser's own if one is published |
| D25 | Should the page changes reach the old pages at once (T73), or only as each page is redone? | answered 2026-11-17: at once. Race, Compare and Gear were restyled in T73 and every page is in the card style, so nothing is left to decide |
| D30 | Which files can be uploaded as a plan? `.ics` and CSV (`date, title, distance_km`), built in T109. Why those two: whole plans are rarely exported as files by the platforms (TrainingPeaks, Final Surge and Runna have no plan-level ICS or CSV export that was found); coaches mostly deliver through the platform's own calendar, a PDF, or a Google Sheet, and a Sheet downloads as CSV. Higdon's plans are web tables with third-party scripts that make an ICS. PDF is common but not built: it needs reading tables out of a layout. A TrainingPeaks or other iCal feed address can already be subscribed in Settings | decided (recommended, owner not objected) |
| D32 | Edits stay in the app and are not written back to the Google calendar (the feed is read-only, and writing would need a Google login). Recommended: yes | answered 2026-11-17: yes, edits stay in the app for now; writing back to a calendar is a later idea (`FUTURE.md` section 21) |

### Decided

Numbering continues from `docs/history/PLAN-HISTORY.md`, which ends at D16.

| ID | Decision | Date |
|---|---|---|
| D17 | **Light is the default theme.** A browser with nothing stored gets light, not what the OS says. A saved choice, including System, wins. | 2026-11-09 |
| D18 | **The page is capped at 1480 px, and the root font follows the window between 15 and 17 px.** A large display gets margin, not bigger cards. Windows under 52 rem tall use compact spacing so a laptop fits the Today cards without scrolling. | 2026-11-09 |
| D19 | **Explanations open in a popup, not in the card.** `InfoPopover` is the pattern: the answer stays on the page and the working is one click away. Content that is the page (the load charts, the gym detail, a form) still expands in place. | 2026-11-09 |
| D20 | **Today replaces Status.** The route stays `/status`; the nav says Today. Load and gym sit behind a toggle until a Train page exists. | 2026-11-09 |
| D21 | **The race forecast prices the plan's kilometres at the owner's own load per km,** and judges the likely line by the kilometres run over the last 28 days against the plan, not by the plan's session score. A fresh race-morning form is a warning when fitness is falling. The finish range always takes in the Riegel exponent band; the fitness and form adjustments are rules of thumb and are returned apart from the raw range. | 2026-11-09 |
| D22 | **The analytics cache version carries today's date,** so answers about today (the load curve, the race countdown) recompute after midnight and not at the next write. | 2026-11-09 |
| D26 | **Weather comes from Open-Meteo.** Free for personal use, no key, hourly history to 1940 and the same fields as a forecast. Stored per activity so the app never depends on it being up. klimat.app could not be verified. | 2026-11-12 |
| D27 | **A named plan's number is the day's target.** While Higdon's plan is on it beats the club's and the owner's own number, on Mon, Tue and Fri alike. A `GA:` hint, an event stating its own distance, or a race wins. | 2026-11-14 |
| D28 | **Mapbox Standard is the base map,** for its 3D buildings and the flyover. Google photorealistic 3D tiles are to be tried once there is a key. | 2026-11-14 |
| D29 | **Publish as a self-hosted open-source project first.** Not a hosted service: that would hold other people's Garmin tokens and health data on an unofficial login. The official Garmin API is considered after about 500 stars. Detail and steps in `FUTURE.md`. | 2026-11-15 |
| D31 | **A new plan takes over from a day the owner picks** (default next Monday). Earlier weeks keep the old plan's sessions and the judgement they already got; the old source is kept, switched off. | 2026-11-15 |
| D33 | **A ride's totals use the recorded data as is.** A stretch estimated across a recording gap (T86) is drawn dashed and noted, and never counted in distance, heart rate, load or best efforts (T88 dropped). Whether to snap GPS to roads and estimate true numbers is an idea in `FUTURE.md`. | 2026-11-15 |
| D34 | **The nav is Today, Train, Activities, Map, Health.** Train holds the plan, the race, the load and the trends as tabs (Trends folds in, D23). The page that was to be called Body stays **Health**, and the page that was to be called Places stays **Map**. Fewer renames, and each name says what is on the page. | 2026-11-16 |
| D35 | **The default branch is `main`, not `master`.** Renamed 2026-11-16 here, on origin and as GitHub's default, to match the owner's other projects. Older entries in this file and in `docs/history/PLAN-HISTORY.md` keep saying `master` where they describe the past. | 2026-11-16 |

### Parked (not planned; ask the owner before starting)

- **`indoor_cardio` and `hiit` become `other`** in `activities` (`ingest/normalize.py`
  `TYPE_MAP`). The original type survives only in the raw payload.
- **A brute-force lockout on `APP_PASSWORD`**: login is off by the owner's choice (D2).
- Per-set gym detail, Strava and other sources, and course, heat and non-running load in the race
  forecast: see `FUTURE.md`, which holds the detail.
