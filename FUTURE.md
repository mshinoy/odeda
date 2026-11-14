# Future plans and trajectories

Ideas worth keeping that are **not scheduled**. `PLAN.md` holds what is being built and its
"Parked" list holds small known gaps; this file holds the bigger directions and the
reasoning behind them, so a good idea survives until it has the data or the need to build it.

Design intent for everything here: **ease of information retrieval and not a lot of
information.** Answers first, detail one click away.

How to use it: add an idea with its *why*, what it would take, and what would trigger
building it. When one is started, move it into `PLAN.md` as tasks and leave a pointer here.

---

## 1. Race-scoped plans

*Raised 2026-11-14. Waiting on a second race in the calendar (Doha Half on 2027-01-15 is the
only one), so there is nothing real to test against yet.*

**Why.** The Higdon change made the named plan the base for each day. The same idea applies
one level up: the goal race's plan should be the focus, and every number should be measured
against it. Today one `start_day` and "nearest upcoming race" do this loosely. After Doha the
goal moves to the next race, but old weeks still count in the weekly totals, adherence and
the plan's peak, so the next block would be judged against a build that is over.

**What it would take.**
1. **A block per race.** From the day after the previous race to this race's day. Weekly
   totals, adherence, peak, load target and the forecast count only that block. The next
   race starts a fresh block automatically. Replaces `plan_sources.start_day` as the normal
   case (keep it as an override).
2. **Any named plan, not only Higdon.** The parser's cues are `HIGDON SAYS/PRESCRIBES/ASKS`
   and `PLAN ASKS` (`plan/parse.py`, `_PLAN_FIGURE`). Generalise to `<plan name> says/
   prescribes/asks`, and take the plan name and week from the week note's header
   (`HIGDON NOVICE 1 - WEEK 3 of 12`). A `GA: plan=…` hint is the exact form.
3. **A label.** "Higdon Novice 1 · week 3 of 12 · Doha Half in 63 days" on Today and the
   activity page. Cosmetic, but it says which plan is driving the number.

**Rules already decided** (2026-11-14): while a named plan is on, its number is the target
for every day (Mon, Tue, Fri alike), over the club's and the owner's own. A `GA:` hint, or an
event stating its own distance in its title (a dated taper one-off), still wins. A race beats
everything on its day and in its taper.

**Open.** Does a race with no named plan (just a date) get a block? Probably: the calendar's
own sessions, as before. Back-to-back races a week apart: which block owns the days between?

**Build when:** a second race is in the calendar.

---

## 2. Moved and swapped runs

*Raised 2026-11-14, deferred by the owner.*

**Why.** The Higdon rule is strict: a day is judged against the plan's number. The stated
exception is when a run is moved or swapped, which today only has a one-day tolerance
(`MOVE_TOLERANCE_DAYS`) and a ride-for-run "substituted" verdict.

**Shape.** Let a run done on another day of the same week satisfy the missed day (the plan's
number, not the day it fell on), with the week still adding up. Let the owner say "this was
the swap" by hand, as the activity-to-session link already allows.

---

## 3. Show the plan against what the club did

*From the Higdon change. Small.*

The club's 8–10 km Tuesday is no longer scored, but it is context worth showing:
"8.2 km · club ran 8–10 · plan asked 4.8 ✓". Needs the club's own number kept on the
session (a new column, or kept out of the target in `plan_sessions`), and one line on the
activity page's plan card.

---

## 4. Weather analytics (T94 in `PLAN.md`)

*Ask the owner before starting.*

Weather is now stored per activity (Open-Meteo, backfilled to all 274 outdoor activities).
Directions, in order of payoff:
- Pace and heart rate against heat and dew point, the owner's own curve rather than a rule
  of thumb.
- A weather-adjusted pace, so a hot week is not read as a fitness drop.
- Race-day weather forecast for the Doha half, and what it costs on the finish range.

---

## 5. Smaller leads kept from earlier work

- **Gear chip** ("add shoes") and key stats from the activity-page design, not built.
- **A post-race page** (T81): the result against the projection, then a recovery block.
- **A weekly digest** (T85) from the six-hourly sync: the week against the plan in a few lines.
- **Per-set gym detail**: needs a new Garmin fetch of `exerciseSets` and a backfill.
- **Non-running load and course in the race forecast.**
- **Monday easy runs** were missed about 8 of the last 9 weeks. Worth asking whether they
  are part of the real plan, or should be optional.

---

## Trajectory

Where the app is heading, as a direction rather than a task list:

1. **One plan, honestly measured.** The calendar is the owner's own and stays human-written;
   the app reads it and judges against the number the plan really asks for (done, plus 1–3
   above).
2. **From "did I do it" to "what does it mean".** Weather, load and form turned into a
   short answer per day: am I on track for the race, and what would change that.
3. **Race to race.** Each race gets its own block, forecast, taper and post-race review, and
   the history carries over (blocks 1 and 4 and the post-race page).
