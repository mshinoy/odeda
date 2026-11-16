# Changelog

Versions follow `MAJOR.MINOR.PATCH`. While the app is below 1.0, a new **minor** version
is a release with new things in it, and a **patch** is a fix. The version lives in three
places, kept equal: `pyproject.toml`, `garmin_analytics/__init__.py` (what Settings, then
About, shows) and `frontend/package.json`. A release is a commit on `main` with that
version, tagged `vMAJOR.MINOR.PATCH`.

## 0.1.0: the MVP (2026-11-09)

Everything built up to this point, recorded in [`PLAN-HISTORY.md`](PLAN-HISTORY.md).

- **Sync:** Garmin Connect, the Google Health scale (or a Fitbit export) and a training
  calendar, every six hours, resumable and raw-first. Your edits survive every sync.
- **Today:** the day's session, readiness and sleep, the race countdown with a finish
  range and race-morning form, this week and last week by day, and the weeks of
  kilometres against the plan.
- **Activities:** cards and a table with maps, heart-rate zones, splits and gym
  sessions; editing; comparing two to five.
- **Routes and the map:** loops clustered by ground covered and timed by the lap, segment
  analysis, a lifetime heatmap.
- **Health and Trends:** sleep, HRV, resting heart rate, Body Battery, weight and body
  composition back to 2014, records, streaks and year over year.
- **Plan:** the calendar read and judged, session by session.
- **Gear:** mileage, retirement and bulk reassign.
- **Analytics fixes in this release:** the load curve runs to today, readiness wording
  follows the number, gym sessions match the plan, and the analytics cache refreshes at
  midnight.

Next: see [`PLAN.md`](PLAN.md).
