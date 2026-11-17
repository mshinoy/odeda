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

*Raised 2026-11-14, checked against the code 2026-11-15: still not built. Waiting on a second
race in the calendar (Doha Half on 2027-01-15 is the only one), so there is nothing real to test
against yet.*

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

**Rules already decided and built** (2026-11-14, D27 and T95 in `PLAN.md`): while a named plan
is on, its number is the target for every day (Mon, Tue, Fri alike), over the club's and the
owner's own. A `GA:` hint, or an event stating its own distance in its title (a dated taper
one-off), still wins. A race beats everything on its day and in its taper. The long-run ride
credit (T96) is not block-aware either; a block would have to scope it too.

**Open.** Does a race with no named plan (just a date) get a block? Probably: the calendar's
own sessions, as before. Back-to-back races a week apart: which block owns the days between?

**Build when:** a second race is in the calendar.

---

## 2. Moved and swapped runs

*Raised 2026-11-14, deferred by the owner. Checked 2026-11-15: still only the one-day
tolerance.*

**Why.** The Higdon rule is strict: a day is judged against the plan's number. The stated
exception is when a run is moved or swapped, which today only has a one-day tolerance
(`MOVE_TOLERANCE_DAYS` in `analytics/plan.py`), a ride-for-run "substituted" verdict, and, since
2026-11-14, a ride on a long-run day paying off part of a missed long run (T96).

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

*Ask the owner before starting. Tracked as T94; this entry holds the direction.*

Done already (T89 to T93): weather stored per activity from Open-Meteo, the weather chip, wind
against the route and "Headwind" as a colour-by. Not built: the analytics on top. Directions,
in order of payoff:
- Pace and heart rate against heat and dew point, the owner's own curve rather than a rule
  of thumb.
- A weather-adjusted pace, so a hot week is not read as a fitness drop.
- Race-day weather forecast for the Doha half, and what it costs on the finish range.

---

## 4b. Snap GPS to roads and estimate the real distance

*Raised 2026-11-15. The owner decided today that totals use the recorded data as is (D33, T88
dropped); this is the idea behind that question, kept for later, not planned.*

**Why.** GPS is noisy. Under trees, between buildings and in tunnels the track wanders or
jumps, so distance, pace and the best efforts built on them are a little off, and a recording
gap (T86) leaves a straight line or a guess. Matching the points to the road or path actually
travelled would give a cleaner track and a better estimate of the real ride or run.

**What it would take.**
1. **A map matcher.** Fit the track to the road network with a standard map-matching service
   (OSRM, Valhalla, or Mapbox's Map Matching API). Run it locally in Docker over an OpenStreetMap
   extract: CONTRIBUTING's ground rule 2 allows one runtime call off the machine, and sending
   every GPS point of someone's runs to a third party is a privacy cost. A local matcher is the
   likely choice and needs a regional extract.
2. **Keep both tracks.** The matched track is stored beside the raw one and never replaces it
   (raw-first and user-edits-win, ground rules 3 and 4). The raw data stays the source of truth.
3. **Derived numbers, labelled.** A corrected distance, pace, and best efforts from the matched
   track, shown as "estimated" next to the recorded figures, with a switch for which one the
   charts use. Elevation is not fixed by this (roads do not carry accurate heights here).
4. **Use it where it helps.** Route clustering and segments (cleaner loops), recording gaps and
   tunnels (a filled path rather than a dashed guess, T86 and T87), the compare map.

**Risks to settle first.**
- Runs on trails, parks, tracks and open ground have no road to snap to, and matching can pull a
  track onto the wrong road. It must be off for those, or only offered where the match is good.
- The watch's own distance (wheel or foot sensor, calibrated stride) can be better than the
  matched geometry. The matcher may make numbers worse, so they must differ visibly from
  Garmin's, never silently.
- Numbers that no longer match Garmin Connect cost trust. Default to the recorded figures.

**Open.** Replace the recorded numbers or only show alongside (leaning alongside)? How good does
a match have to be before it is offered? Try first on a few activities with gaps and tunnels
and compare against the known route.

**Build when:** the owner asks. A prototype on a handful of activities would answer the open
questions cheaply.

---

## Toward other people: the open-source route

*Raised 2026-11-15. The decision: publish on GitHub as a self-hosted project, grow it there,
and only then think about Garmin's official API. Do not run a public hosted version.*

**Why self-hosted and not a hosted service.** Garmin has no public API for personal history;
the app signs in the way the unofficial `garminconnect` library does. That is fine on your
own account. As a service it would mean holding strangers' Garmin tokens (a terms-of-service
risk, and Garmin can break or block the login at any time) and storing their health data and
GPS routes (privacy law, breach duty, support). The app is single-tenant by design (no
accounts, one database per person), so a hosted version is a rewrite. Self-hosting keeps each
person's data with them, which is also the reason people want a tool like this.

### 5. GitHub publishing: the work to do

None of this is built. Do it in this order; a new branch from main for each step.

1. **Scan the history for secrets.** `.env` and `.env.bak.*` were never tracked, but check
   every commit, not just the tree: `gitleaks detect` or `trufflehog git file://.`. Look for
   Garmin tokens, the Google Health client secret, `APP_PASSWORD`, Mapbox tokens, home
   coordinates, email addresses. If anything real turns up, rewrite the history or start the
   public repo from a clean squash, and rotate the secret regardless.
2. **Scrub personal data from the tree.** Real routes, coordinates, race names or dates in
   fixtures, docs, `docs/history/PLAN-HISTORY.md`, `docs/history/DECISIONS.md`, `docs/google-health-setup.md`, `docs/history/REVIEW-2.md`.
   Test fixtures must be synthetic (`seed` already makes synthetic data).
3. **Tidy the repo root.** Move `docs/history/PLAN-HISTORY.md` (214 KB), `docs/history/DECISIONS.md`, `docs/history/REVIEW-2.md`,
   `docs/google-health-setup.md`, `docs/history/SPEC.md` into `docs/`. Keep README, LICENSE, CONTRIBUTING,
   CHANGELOG, FUTURE and PLAN at the root. Fix the links in README.
4. **Licence.** MIT is in place ("Garmin Analytics contributors"). Confirm it is what we want;
   AGPL is the alternative if we want a hosted fork to share its changes. Check that every
   dependency licence is compatible.
5. **Disclaimer.** A short block at the top of the README: unofficial, not affiliated with or
   endorsed by Garmin, uses an unofficial login that may break, use at your own risk, your
   data stays on your machine.
6. **README for strangers.** Screenshots and a short screen recording from the demo data
   (`GA_SEED_DEMO=1`), never real routes. The flyover video is the strongest hook. Replace
   `<you>` in the clone URL. Say what it does in two lines, then the quickstart.
7. **First run must work cold.** On a clean machine with nothing but Docker: clone, copy
   `.env.example`, `docker compose up`, see the demo data, connect an account or import a
   Garmin export. Time it; the goal is five minutes. Check `.env.example` explains every
   variable that is required and marks the optional ones (Mapbox token, Google Health).
8. **CI.** GitHub Actions on pull requests: Python tests, frontend lint, typecheck and build,
   and a Docker build. There is no `.github/` yet.
9. **Community files.** `CONTRIBUTING.md` exists; add an issue template (include `doctor`
   output), a pull request template, `SECURITY.md` (how to report a problem; remind users
   the app should not be exposed to the internet without the password gate) and a short
   code of conduct.
10. **Safe defaults.** Binds to `127.0.0.1` out of the box, `APP_PASSWORD` required, no
    default password. Document the Tailscale or reverse-proxy route for remote access.
11. **Release.** Tag `v0.1.0`, publish a Docker image to GitHub Container Registry so people
    can skip building, write the first CHANGELOG entry.
12. **Announce.** r/selfhosted, r/Garmin, r/running, Hacker News "Show HN", the Garmin
    forums. Post the video and screenshots, not a link alone.

**Build when:** the owner says go. Steps 1 to 3 are the safe ones to do first.

---

### 6. Garmin export import, made first-class

**Why.** This is the biggest lever for new users. The unofficial login is the scariest part of
setup and the part most likely to fail. Garmin's own "Export Your Data" needs no password and
no unofficial API.

**What exists.** `garmin-analytics import-zip <file>` reads the export ZIP by the shape of its
JSON (`ingest/export_zip.py`), and `import-fit` reads individual FIT files
(`ingest/fitfile.py`). So the core is there; what is missing is making it the front door.

**What it would take.**
1. **Upload in the app.** A first-run screen: "Import your Garmin export" (drag the ZIP) or
   "Connect Garmin". No terminal needed.
2. **Run against real exports.** Layout and fields change between exports and regions; collect
   a few real ones (with the owner's and volunteers' permission, anonymised) as test cases.
3. **Use the FIT files inside the export.** The export carries original `.fit` files, which
   have the per-second detail (pace, heart rate, cadence, GPS) that the summaries lack. Route
   clustering, segments and best efforts need that detail, so link each activity to its FIT.
4. **Progress and errors.** A big export takes minutes. Show progress, say what was skipped
   and why, and make a re-import safe (no duplicates).
5. **Keep going afterwards.** The export is a snapshot. Say so, and offer the login (or a
   re-import every few months) to stay current.
6. **Docs.** How to request the export from Garmin (it takes up to a few days to arrive).

**Build when:** before the public launch, since it decides whether strangers can try the app.

---

### 7. Goals and race planning

**Why.** "I want a 50-minute 10K" is how most runners think. The app already holds the race
calendar, the plan, training load and trends; it does not yet connect them to a target time.

**Shape.**
- Set a goal: distance, target time, race date.
- Show what it asks: the pace, and the weekly distance and long run that people typically
  need for it.
- Show whether the user is on track: current best efforts and recent load against what the
  goal needs, with a projected finish range and a plain "ahead / on track / behind".
- Suggest what would change that: more weekly volume, easier easy days, a longer taper.

**Overlaps.** Race-scoped plans (1), the race forecast, and the post-race page (T81). Build
this as the user-facing layer over those rather than a second model. For people with no
calendar, the goal alone has to be enough.

**Open.** Where the "typical volume" figures come from; they must be honest guidelines, not
medical or coaching advice. Say so in the UI.

**Build when:** goals have a single place to live and the race forecast is trusted.

---

### 8. Summaries that come to you

**Why.** An app you have to open is an app you forget. A short weekly or monthly note brings
the numbers to the user. This widens the weekly digest idea (T85 in `PLAN.md`).

**Shape.**
- Weekly (Monday morning): the week against the plan, load and recovery in a few lines, and
  one thing to watch.
- Monthly: distance, time, best efforts, trend arrows.
- Channels: email (SMTP the user configures; no mail service of ours), and a push option
  (ntfy, Telegram or a webhook), since self-hosters often prefer those.
- Settings: on or off per channel, day and time, and a preview button.

**Rules.** No data leaves the user's server except to the channel they configured. Plain text
first, a simple HTML version second. The same "answers first, not a lot of information" rule.

**Build when:** the six-hourly sync and the week summary are stable enough to trust unattended.

---

### 9. Training insights

**Why.** Charts need reading. A few plain-language flags turn them into answers, in the spirit
of "what does it mean" in the trajectory below.

**Examples.**
- Load jumped more than about 30% week over week, or the long run is far longer than the
  recent ones.
- Resting heart rate up, HRV down or sleep short for several days: recovery is trending down.
- A quiet week after a hard block; a run of missed sessions.
- Pace for the same heart rate improving (fitness) or slipping (fatigue, heat; see 4).

**How.** Small rules over data we already store, each with a threshold, a one-line message and
a link to the chart behind it. Show at most two or three at a time, ranked. Every rule is
testable on the seeded demo data. Thresholds are guides and the wording must never read as
medical advice.

**Build when:** weather adjustment (4) is in, so heat is not mistaken for lost fitness.

---

### 10. Shareable activity pages and images

**Why.** What people post is what brings new users. The flyover video export already does this
for one view; the same idea for a plain image or page covers the rest.

**Shape.**
- **Image export** of an activity: map, pace, heart rate and the headline numbers, in square,
  vertical and horizontal crops, with a light and a dark style. Reuse the video export's
  rendering where possible.
- **Privacy first.** Offer "hide start and end" (trim the first and last few hundred metres),
  and no live link by default. A public page would need the server reachable from the
  internet, so for now the output is a file the user posts themselves.
- Later, an optional read-only share link for people who already expose their server.

**Build when:** the video export is settled and the privacy trim exists.

---

### 11. More sources: Strava and others

*Compared with Endurain on 2026-11-17: it syncs Strava as well as Garmin Connect, so this is the main source gap.*

**Why.** Many runners are not on Garmin only, and Strava is where activities are shared. The
Fitbit work shows the data layer can take a second source (`fitbit.py`, `fitbit_sync.py`,
`body_composition`).

**Shape.** A small source interface (fetch, normalise, dedupe against existing activities),
Strava first via its official API or its data export, then Coros, Polar, Suunto or plain
GPX/FIT upload. The same activity from two sources must merge, not double.

**Build when:** the export import (6) works and users ask for it.

---

### 12. After 500 stars: the official Garmin API

*Not before. A milestone, not a date.*

*Checked 2026-11-17: Endurain, the best-known self-hosted Garmin project (about 2 400 stars, 52
contributors, 30 releases in ten months), still syncs through the unofficial `python-garminconnect`
library according to its docs. They do not say whether they ever applied for the official API. So
stars alone may not be the unlock assumed here, and the official route may suit a hosted service
more than a self-hosted app. Treat 500 stars as a reason to ask, not a promise of an answer.*

**Why wait.** Garmin's Connect Developer Program (the Health and Activity APIs) is free but
gated: you apply and they review the product and use case, and they have favoured businesses
over hobby projects. A project with 500 stars and real users is a far better application than
an idea. (Check Garmin's current terms before relying on this; they change.)

**What it implies.** The official API pushes data to a public webhook on the developer's
server after the user authorises with OAuth. That only works for a hosted, multi-user service.
Self-hosters could not use it without each getting their own approval. So this is the hosted
service we are deliberately not building yet, and it means:
- Accounts and per-user storage; the single-tenant design has to change.
- Consent, export and delete-my-data flows, and privacy law (GDPR and others).
- A reachable server, cost, monitoring, backups and support.
- Garmin's branding rules; "Garmin Analytics" may not be an allowed name (see 13).

**Steps when the time comes.** Re-read the program's terms, write the application with usage
numbers and a privacy statement, get an evaluation key, build the multi-user version beside the
self-hosted one (the self-hosted one stays free and open), then apply for production access.

---

### 13. Rename

*Later, and trivial to do.* The name leads with Garmin's trademark. Pick a name that does not,
before the project has a following, and ideally before the first public release.
What changes: the repo and package name (`garmin_analytics`, the `garmin-analytics` command,
Docker volume `garmin-analytics-data`, image name), README, docs, licence holder line, UI title.
Provide a one-time migration note for existing installs (volume name, command name). Keep
"works with Garmin" wording in the description; that is allowed even when the name is not.

---

## 14. Smaller leads kept from earlier work

- **Gear chip** ("add shoes") and key stats from the activity-page design, not built.
- **Post-race page and weekly digest** are tasks T81 and T85 in `PLAN.md`; the digest is
  widened in section 8. Not repeated here.
- **Per-set gym detail**: needs a new Garmin fetch of `exerciseSets` and a backfill.
- **Non-running load and course in the race forecast.**
- **Monday easy runs** were missed about 8 of the last 9 weeks. Worth asking whether they
  are part of the real plan, or should be optional.

---

## 15. A faster first run for a new person

*Raised 2026-11-16, while rewriting the README.*

**Where a newcomer is today.** Clone, copy `.env.example`, edit it by hand (a password, `TZ`, resting
and maximum heart rate), `docker compose up`, open the page. Connecting Garmin and starting the
backfill is already done from Settings, with a size estimate first, so the CLI is no longer needed.
What is left is friction: the `.env` edit is the first thing anyone meets and a wrong value only
shows later (heart rate drives every load number, `TZ` drives "today"); an empty database opens on
a Today page with nothing to say and no pointer to Settings; and the Google Health scale and the
training calendar each need steps outside the app.

**Built 2026-11-16 (T116):** ideas 1 and 2 below, with a password change in Settings. The rest stay ideas.

**Ideas, smallest first.**

1. **A first-run card on Today** that shows only while there is no activity data: connect Garmin,
   or load demo data to look around, with the link to Settings. It disappears on its own.
2. **Settings holds the basics:** time zone (default from the browser), resting and maximum heart
   rate (defaults from the data once there is some), and the password, instead of `.env`. They would
   be stored in the database and the environment value would stay as the starting default.
3. **One command for the start:** a `setup` script that writes `.env` with a generated password
   and the host's `TZ`, then runs `docker compose up -d` and prints the address.
4. **Demo data from the UI:** a button in Settings that loads the synthetic data and one that wipes
   it, so nobody needs to reset a volume by hand.
5. **A checklist at the top of Settings:** each source with its state and the next step, so the
   Google Health and calendar steps are explained where they are needed.

**Trigger.** Do 1 and 2 before the repository goes public. Ideas 3 to 5 follow the first outside
person's feedback.

---

## 16. Miles as well as kilometres

*Raised 2026-11-17, from comparing with Endurain (which has an imperial and metric switch). Checked
against the code the same day: the app is kilometres only, there is no unit setting.*

**Why.** Most Garmin owners in the US and the UK think in miles, and "min/mile" and feet of climb are
what they would look for in the first minute. A stranger who sees kilometres only may close the tab.
Of everything on that comparison, this is the one most likely to cost real adoption.

**What it would take.**
1. **A units setting** (metric or imperial) beside the Basics card in Settings, stored like the other
   basics. Storage stays in metres and seconds; only the display changes.
2. **The display layer.** `frontend/src/lib/format.ts` is the one place numbers become strings
   (`formatDistance`, `formatPace`, `formatSpeed`, `formatElevation`, and `formatTemperature` for
   Fahrenheit), but about 67 frontend files use distance or pace formatting, and some pass literals
   such as `"km"` or `km/h`. Chart axes and tooltips are the part most likely to be missed.
3. **The backend's own wording.** Some text is built on the server (plan targets, pacing and
   forecast lines, the "weekly km" series). Those either take the unit as a parameter or are
   returned as numbers for the page to word.
4. **Training calendars written in miles.** The calendar parser reads "target 18 km" today. A plan
   written in miles needs "7 mi" understood, or the numbers the plan steers by would be wrong.
5. **Tests.** A pace of 5:00 per km is 8:03 per mile; assert against values worked out by hand.

**Build when:** before the public launch if the first audience is outside the owner's own region.
It is a moderate change, and it should be planned as one task per layer, not one big one.

---

## 17. Gear components

*Raised 2026-11-17, from Endurain's "gear component tracking".*

**Why.** Shoes retire on distance, which the Gear page already does. A bike has parts that wear out
on their own schedules: the chain, the tyres, the brake pads. "Chain at 2 800 km, replace at 3 000"
is the same idea one level down and is cheap on top of what exists.

**Shape.** A component belongs to one gear item, with a name, a fitted date, a distance already
done and a replace-at distance. Its mileage is the gear's mileage since it was fitted, so replacing
a chain is "retire this one, add a new one" and the old one keeps its history. The retirement
warning reuses the shoes' warning state.

**Build when:** someone asks, or when the Gear page is next opened for another reason. Small.

---

## 18. Other languages

*Raised 2026-11-17, from Endurain's multi-language support.*

**Why.** Reach, once the project has users outside English-speaking countries. Not before: text is
written inline in the components, there is no translation layer, and adding one touches everything.

**Shape.** Move the visible strings behind a message catalogue, English first, with the question each
card asks as part of the catalogue. Dates and numbers already follow the browser locale where
`format.ts` is used.

**Build when:** a contributor offers a second language, or a clear group of users asks. Not planned.

---

## 19. Deliberately not built

*Recorded 2026-11-17 so the question is not reopened each time a similar project is compared.*

Multiple users, followers and activity feeds, privacy levels, sign-up with email verification,
password reset by email, single sign-on (OIDC and SAML), and one-time-code logins. All of it serves
a service with many people on one server. This app is one person's data in one container with one
password, and that is why it starts in a minute; each of these would cost that. If a household
wants two people, they run two containers.

---

## 20. What made Endurain popular, and what we take from it

*Read from its docs site and GitHub on 2026-11-17. Their numbers: created October 2023, about 2 400
stars, 154 forks, 52 contributors, 30 releases in ten months, a monthly release target, a blog.*

**What worked for them.**
- **A one-sentence pitch** everyone already understands: "similar to Strava but focused on privacy".
- **Breadth:** Garmin and Strava sync, a feed, goals, gear, a mobile app, about eleven languages,
  several users on one server.
- **Visible momentum:** frequent tagged releases, a blog announcing each, Discord, Mastodon,
  Bluesky and a newsletter, translations contributed through a translation site.
- **A live demo** that resets daily, so a stranger sees it working before installing anything.
- **Docs that are easy to navigate** (search, sections, a real troubleshooting page that explains
  where to look in the logs), and a sharing page that says plainly "private by default".

**Where they are weak, which is our opening.**
- **Setup is heavy:** a domain name, ports 80 and 443, a reverse proxy, Postgres, four generated
  secrets and an `admin/admin` first login. Ours is one container and one password, and the
  password, time zone and heart rate can be set in the app. Say so in the README.
- **Garmin credentials** reach their server unencrypted unless HTTPS is set up, which the docs
  only "highly recommend". Ours are used once for a token and never stored.
- **Docs are dense and English only,** with few screenshots.

**What we take.**
1. **A sharper pitch.** Theirs is "Strava, but yours". Ours should be as short and as concrete:
   Garmin shows what happened; this says whether you are on plan for your race, and where on your
   own routes you gain and lose. (Positioning notes were discussed 2026-11-17: serve runners
   following a training plan toward a race, which nobody on the comparison does.)
2. **Something to try before installing.** A hosted demo on synthetic data is the best answer and
   needs a small always-on server; until then, good screenshots and a short screen recording (T115).
3. **Visible cadence.** Keep tagging releases with a changelog entry, and say in the README that
   the project is active. A short "what is new" block under the title costs nothing.
4. **Somewhere to talk.** GitHub Discussions (a switch in the repository settings) is the cheap
   version of their Discord, and keeps questions out of the bug tracker.
5. **A troubleshooting page** for the failures that will actually happen: Garmin refusing the
   login, an empty database, a wrong time zone, a port already in use. The `doctor` command is the
   core of it. There is a start in `docs/connecting-garmin.md`.

**What we do not copy:** the breadth. Endurain is a product for groups; this is a sharp tool for
one runner (see 19). Competing on features with a project that has 52 contributors is the wrong
fight.

---

## Video export, ideas not built

The export takes about 0:38 for a 60 s HD vertical video and is now limited by the encoder
(~41 fps). Ideas left on the table:

- Two encoders working in parallel, joined in order.
- Hand canvases to the encoder as `OffscreenCanvas` instead of snapshotting them.
- A cleaner Mapbox Standard setup for export (no labels or 3D objects) so tiles load faster.
- Longer runs of consecutive frames per map (16 instead of 8).
- Square and horizontal crops, 2K and satellite are untested end to end; so are real
  Instagram and YouTube uploads.
- The `[video export]` console entry could be stored (server or download) for later analytics.

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
4. **From my app to other people's.** Open source and self-hosted first: publish on GitHub,
   make a first run work without the unofficial login (Garmin export), then add what a
   stranger needs (goals, summaries, insights, shareable images). Hosted service and the
   official Garmin API only after real demand (500 stars). See "Toward other people".
