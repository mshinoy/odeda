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
2. **Any named plan, not only Higdon.** *Built 2026-11-24 (T130): the plan's name is read from the
   week note's header and its `says/prescribes/asks` is the quoted voice; a `GA: plan=…` hint is not.*
   Before that the parser's cues were `HIGDON SAYS/PRESCRIBES/ASKS`
   and `PLAN ASKS` (`plan/parse.py`, `_PLAN_FIGURE`). Generalise to `<plan name> says/
   prescribes/asks`, and take the plan name and week from the week note's header
   (`HIGDON NOVICE 1 - WEEK 3 of 12`). A `GA: plan=…` hint is the exact form.
3. **A label.** *Built 2026-11-24 (T130) on Today and Train: name, week and a progress bar.
   Not yet on the activity page.* It says which plan is driving the number.

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
4. **Licence.** MIT is in place ("Odeda contributors"). Confirm it is what we want;
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

**What exists.** `odeda import-zip <file>` reads the export ZIP by the shape of its
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
- Garmin's branding rules; "Odeda" may not be an allowed name (see 13).

**Steps when the time comes.** Re-read the program's terms, write the application with usage
numbers and a privacy statement, get an evaluation key, build the multi-user version beside the
self-hosted one (the self-hosted one stays free and open), then apply for production access.

---

### 13. Rename

*Done 2026-11-17: the project is now called **Odeda** (Malayalam, "run, da!"). Kept on purpose: the Docker volume name `garmin-analytics-data`, the `GA_` settings prefix, the `ga_session` cookie and the `~/.garminconnect` token folder, so existing installs keep working. A tidier volume name can come with a one-time copy later.*

*Original note.* The name leads with Garmin's trademark. Pick a name that does not,
before the project has a following, and ideally before the first public release.
What changes: the repo and package name (`odeda`, the `odeda` command,
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

*Raised 2026-11-17. Checked
against the code the same day: the app is kilometres only, there is no unit setting.*

**Why.** Most Garmin owners in the US and the UK think in miles, and "min/mile" and feet of climb are
what they would look for in the first minute. A stranger who sees kilometres only may close the tab.
Of the gaps known today, this is the one most likely to cost real adoption.

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

*Raised 2026-11-17.*

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

*Raised 2026-11-17.*

**Why.** Reach, once the project has users outside English-speaking countries. Not before: text is
written inline in the components, there is no translation layer, and adding one touches everything.

**Shape.** Move the visible strings behind a message catalogue, English first, with the question each
card asks as part of the catalogue. Dates and numbers already follow the browser locale where
`format.ts` is used.

**Build when:** a contributor offers a second language, or a clear group of users asks. Not planned.

---

## 19. Deliberately not built

*Recorded 2026-11-17 so the question is not reopened.*

Multiple users, followers and activity feeds, privacy levels, sign-up with email verification,
password reset by email, single sign-on (OIDC and SAML), and one-time-code logins. All of it serves
a service with many people on one server. This app is one person's data in one container with one
password, and that is why it starts in a minute; each of these would cost that. If a household
wants two people, they run two containers.

---

## 20. A live demo, and the demo mode it needs

*Raised 2026-11-17.*

**Why.** People decide in a minute, and they would rather click through a working app than read
about one. The seeded synthetic data (`GA_SEED_DEMO=1`: about three years, repeated GPS routes, a
training plan) already exists and looks real. Screenshots (T115) are the minimum; a live demo is the
version that convinces.

**Why it is not just "run the app on a server".** Today anyone who reaches the page can change the
password, connect their own Garmin account, upload a plan, edit or exclude activities, merge routes,
start a sync, or save new basics. A public instance needs a **demo mode** first.

**Demo mode (an environment setting, for example `GA_DEMO=1`).**
- **Read-only.** Every request that changes data is refused with a plain message ("this is a
  read-only demo"). The list to block: the password, Garmin, Fitbit and plan-source endpoints; plan
  upload and edit; activity edits, exclusions and reverts; gear writes and bulk reassign; route
  rename, merge, split and recluster; sync start; saving the basics. The reading endpoints stay.
- **Nothing to connect.** The Garmin, Google Health, plan-address and password cards are hidden or
  shown as examples, not as forms.
- **A banner on every page:** "Demo with synthetic data. Run your own in one minute", linking to
  the quickstart in the README.
- **Resets itself.** Even with writes blocked, the database is rebuilt from the seed on a schedule,
  so a bug can never leave something lasting.
- **Only ever the seed.** The demo has its own data directory and never mounts a real database. The
  `doctor` command and `/api/health` already say the data is synthetic.
- **Cheap to abuse-proof:** a request rate limit, and the heavy work (the 3D flyover export runs in
  the browser) left to the visitor's own machine.

**Where to host it.**
1. **A small cloud server** (about five dollars a month), one container behind HTTPS. The preferred
   option: isolated from any real data and from the owner's home network.
2. **Not the owner's own machine.** It is a two-CPU box that already exposes one public port, and a
   public demo would add load and attack surface beside the real database.
3. **A static copy on GitHub Pages:** the real interface over recorded API answers. Free and very
   safe, but only the pages and filters that were recorded work, so it feels thin, and it is more
   build work than demo mode.
4. **A screen recording or GIFs in the README**, as the fallback and for places that cannot embed
   a live page.

**Steps.** (1) The setting and the write block, with a test that lists every route and fails when a
new write route is added without a decision. (2) The banner and the hidden cards. (3) The scheduled
reset. (4) A small image or compose file for the demo. (5) Choose a host and a domain, and link it
from the top of the README.

**Build when:** before the public launch, after the README screenshots. Step 1 is useful on its own
even without a hosted demo, because it is also how someone could safely show the app to a friend.

---

## 21. Writing edits back to a calendar

*Raised 2026-11-17, while answering D32. Decided for now: edits stay in the app.*

**Why it might matter later.** A session edited in the app (a day moved, a distance changed) is
shown over the calendar's version, but the calendar itself still says the old thing. Anyone who
also reads that calendar on a phone or shares it with a coach sees two different plans.

**Why it is not built.** The calendar feed is read-only, so writing back needs a sign-in to the
calendar provider (Google needs OAuth and an app registration), a way to match an edited session
to the right calendar event, and care that a sync never overwrites what was just written. It also
adds a second credential to a project whose pitch is that it holds almost none.

**What it would take, if it comes back.**
1. One provider first (Google Calendar), with the narrowest permission that can edit events.
2. A per-edit choice, so nothing reaches the calendar unless asked.
3. Calendar-neutral wording and a second route for other calendars (an iCal file export, or
   CalDAV), so the feature is not tied to one company.
4. Tests for the two-way case: an edit made in both places, and a deleted event.

**Build when:** someone who shares their calendar with a coach asks for it. Not before.

---

## 22. Google Maps as a basemap choice

*Raised 2026-11-19, while putting the demo on Mapbox.*

**Why.** Today the basemap is CARTO / OpenStreetMap by default and Mapbox with a token
(`providerFor(env)` in `frontend/src/map/`). Some people already have a Google Maps key, and
Google's photorealistic 3D tiles would suit the flyover better than any flat style. A third choice
costs little if it sits behind the same provider seam.

**Shape.**
- A `google` provider next to `maplibre` and `mapbox`, chosen by a build-time key like the Mapbox
  token (`VITE_GOOGLE_MAPS_KEY`). 2D roadmap and satellite tiles from the Map Tiles API; the 3D flyover
  from the photorealistic tiles through deck.gl's `Tile3DLayer`.
- Static images for the activity cards from the Static Maps API, as Mapbox's are today.
- Attribution and the logo kept on screen, and no tiles stored or cached beyond what Google allows;
  their terms are stricter than Mapbox's here, so read them before building.
- The key restricted by referrer in the owner's Google Cloud project, and a budget alert set. Like the
  Mapbox token, it ends up in the page code.

**Open question.** Cost. Google bills per tile or session after a free allowance, so a public demo on
it is worth pricing first. The demo stays on Mapbox until then.

**Build when:** someone asks for it, or the photorealistic flyover is wanted. Not before.

---

## 23. Ask your data: an assistant inside Odeda

**Why.** The questions the owner keeps asking in a chat today are the ones the app should
answer: how are my runs trending, why am I slower, is it effort or weight? A chat window in
Odeda that reads the same numbers the pages show would answer them without copying anything out.

**Shape.**
* **Any model.** One small interface with two adapters: the OpenAI-style chat API, which
  OpenAI, OpenRouter, Ollama, LM Studio, llama.cpp and vLLM all speak (so a model on the
  owner's own machine works), and Anthropic's own. Settings holds the provider, the address, the
  model and a key; nothing is built around one vendor.
* **Read-only tools, not raw SQL.** The model calls a short list of functions over the existing
  analytics (trends, weight against load, a run's splits, plan adherence, weather, sleep). It
  never edits, syncs or deletes, and it sees only what the owner's pages already compute.
* **The code does the arithmetic.** Models are poor at sums and decent at telling. Every number
  comes from a tool result, and the answer says which tool, so it can be checked.
* **Privacy, said plainly.** With a hosted model the questions and the numbers they touch leave
  the machine; with a local one nothing does. Settings says which is in use. Keys are never
  logged or sent to the page.
* **The public demo** gets no assistant, or a rate-limited one, because someone else pays for it.

**Honest limit.** A small local model will be weaker at picking the right tool and at
explaining a cause. "Why am I slower" is a hypothesis from the data, never a diagnosis.

**Build when.** After the plan and weight views settle, because the assistant is only as good as
the functions it can call. First step: the tool list and an eval of ten real questions against
two providers.

## 24. Bring your own training plan, any sport

**Where it stands.** A plan can already come in as a calendar subscription or an uploaded
`.ics` or CSV from a chosen day, and a published running plan named in a week note (Higdon
Novice 1) takes precedence and is shown on Today and Train (T130). What is thin is everything
that is not a distance run: judging is led by distance today.

**What it would take.**
* **Sessions measured in more than kilometres.** Time, heart-rate zone, power or load for a
  ride, a swim in metres, a brick as two parts, so a cycling or Ironman block is judged the way
  a running one is.
* **More ways in.** A plan template for the common published plans (Higdon, Pfitzinger,
  a couch-to-5K), a TrainingPeaks or Intervals.icu export, a structured workout file, and a
  plan typed or pasted as a table.
* **More than one plan at once.** A run plan and a ride plan side by side, each judged on its
  own sport, with the week showing both.
* **Plan names and day names carried through**, so "Base run" or "Brick" shows as the plan calls
  it, not only the kilometres.

**Honest limit.** Odeda reads and judges a plan; it does not write or coach one, and that stays.

**Build when.** When the owner starts a ride or triathlon block, or a second person brings a plan
the parser cannot read. First step: a cycling plan from a real source, to see what the parser
misses.

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
