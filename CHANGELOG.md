# Changelog

Versions follow `MAJOR.MINOR.PATCH`. While the app is below 1.0, a new **minor** version
is a release with new things in it, and a **patch** is a fix. The version lives in three
places, kept equal: `pyproject.toml`, `odeda/__init__.py` (what Settings, then
About, shows) and `frontend/package.json`. A release is a commit on `main` with that
version, tagged `vMAJOR.MINOR.PATCH`.

## Unreleased

- **Today says what became of the session:** once today's run or ride has an outcome, the headline reads "Done · 10.2 km" (or "Short · 5.0 km of 9.7 km", "Missed") with the session's name above it, in place of "Today's sessions are done".
- **A quieter Today card:** it no longer repeats "Today" above the headline, since the date line already says it.
- **A backup button:** Settings has a Download backup card, and `odeda backup` does the same from the command line. One zip holds the database (every Garmin response and every edit) and your course files. Your Garmin and Google sign-ins are left out on purpose, so the file is safe to keep in a cloud folder; sign in again after restoring. Restore steps are in the configuration docs.
- **A banner when the data stops updating:** if your Garmin login lapses, every page says so at once and points to Settings. If any other source (Google Health, the training calendar) fails two automatic runs in a row, the banner says that too, with what the source reported. One failed run says nothing, and the banner goes when a run succeeds.
- **Weeks are Monday to Sunday at New Year too:** the weekly totals in Activities and the biggest-week record cut the week of New Year in two (Dec 28 to Jan 3 read as two light weeks). They now use ISO weeks like the plan and Today.
- **The plan driving your numbers is named on screen:** Today and Train show the published plan the week notes name ("Higdon Novice 1 · week 5 of 12"), which takes precedence, or otherwise the calendar's own name. Any plan name works in the week note, not only Higdon's. Each session still to come in the week list shows its distance, and the Today card says what the published plan asks for that day ("Higdon Novice 1 asks for 6.4 km, easy run").
- **Laptop screens look like the browser at 90%:** the interface is a tenth smaller up to 1440 px wide, so a 13-inch screen has room at the sides, and the page padding is fluid (24 to 48 px) instead of a fixed 32 px. Large displays are unchanged.

- **Mapbox on the public demo, without the token on the page:** `VITE_MAPBOX_PROXY` makes the map library
  ask this site for map data and a server in front (`deploy/demo`) adds the token, allows only map
  requests and limits how fast they can be made.
- **Hosting the demo:** `deploy/demo/` has what runs the public demo at odeda.run behind Cloudflare.
- **Demo mode:** `GA_DEMO=1` makes an instance read-only for a public demo. Every change is refused with a
  clear message, there is no sign-in, and a banner says the data is synthetic.

## 0.3.0: Odeda, and a first run that is easier (2026-11-19)

*Odeda* is Malayalam for "run, da!". The name no longer leads with Garmin's trademark.

- **First run:** Settings has a Basics card (time zone, resting and maximum heart rate) and a
  Password card, and Today shows a short first-run checklist. Changing heart rate recomputes
  the stored training load. A password chosen in Settings survives a restart.
- **README and docs:** a short front page with a screenshot gallery, the detail moved to `docs/`,
  a bug-report issue template, and a public `ROADMAP.md`.
- **Demo data:** the seeder now gives strength sessions real exercises, sets and weights, and
  lays its synthetic runs and rides onto recorded Doha routes. `scripts/demo-plan.py` loads a
  matching half-marathon plan.

- **Renamed:** the Python package is `odeda`, the command is `odeda` (it was `garmin-analytics`),
  and the Docker image and containers are `odeda`, `odeda-api-dev` and `odeda-ui-dev`. The UI
  title, the API title and the licence holder say Odeda.
- **Existing installs:** rebuild with `docker compose up -d --build`, then use `odeda` in place of
  `garmin-analytics` in commands (`docker compose exec app odeda doctor`). Nothing else has to change.
- **Kept on purpose:** the data volume is still `garmin-analytics-data` (renaming it would start
  from an empty one), the settings still start with `GA_`, the session cookie is still
  `ga_session`, and the Garmin token folder is still `~/.garminconnect`. Outside Docker, an
  existing `~/.local/share/garmin-analytics` folder is used until a new `odeda` one exists.
- **Older entries** below and `docs/history/` keep the old name; they describe what it was called then.

## 0.2.0: the redesign and the Train page (2026-11-16)

- **A new look everywhere:** every page is in the card style, with the question each card
  answers as its title. Map, Routes, Health, Trends, Race, Compare, Gear and Settings were
  restyled.
- **Train:** Plan, Race, Load and Trends are tabs on one page. The nav is now Today, Train,
  Activities, Map and Health.
- **Plan that steers:** the day's target follows the plan in use, a session can be edited,
  a plan can be uploaded, a ride on a long-run day pays off part of it, and Today says when
  a long run was missed or cut short.
- **Race:** a race-day pacing plan and a taper check on the race card.
- **Activity pages:** answers first for runs, rides and gym, laps and workout steps against
  the plan, weather and wind, routes coloured blue to red.
- **3D flyover:** replay readout, Mapbox Standard base map and a fast MP4 export.
- **Fixes:** no line across a recording gap, no average pace across sports, no change shown
  against a near-empty year, no duplicate keys on Today.
- **Project:** `PLAN.md` is the tracker and a commit hook keeps it current; the default
  branch is `main`.

## 0.1.0: the MVP (2026-11-09)

Everything built up to this point, recorded in [`docs/history/PLAN-HISTORY.md`](docs/history/PLAN-HISTORY.md).

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
