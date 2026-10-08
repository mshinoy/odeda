# Decisions

Calls made during the overnight build of 2026-09-22, with reasons. The user was asleep
and explicitly authorised deciding without asking. Later calls are appended with their
date; an entry that no longer holds keeps its text and says what superseded it.

---

### D1 — venv built with `--without-pip` + host pip `--python`
`python3-venv` is not installed on this box, so `python3 -m venv .venv` fails at the
ensurepip step. Installing system packages needs sudo and was out of scope. Instead:
`python3 -m venv --without-pip .venv`, then `python3 -m pip --python .venv/bin/python
install …`, which also installs pip *into* the venv, leaving it self-sufficient
afterwards. Documented in README so a rebuild doesn't hit the same wall.

### D2 — no numpy/pandas
18 months of daily data is ~550 rows and ~400 activities. SQL plus stdlib `math`
is faster to load, easier to unit-test, and keeps the venv at ~100 MB on a disk with
4.5 GB free. Every statistic (mean, sample stdev, EWMA, z-score) is written out
explicitly in `analytics/`, which also makes the test fixtures hand-checkable.

### D3 — `python-garminconnect`, after `garth` was deprecated and then failed
Superseded twice, which is the point of writing it down.

**First:** the spec named `garth==0.8.0`, which emits `DeprecationWarning: Garth is
deprecated and no longer maintained` (matin/garth#222). Used anyway — it worked, and
all Connect calls already went through one thin adapter.

**Then (2026-09-23):** the login stopped working. Garmin fingerprints the client on the
login route; measured from this host, same URL and body one second apart, `requests`
and curl got 429 while `curl_cffi(chrome)` got a clean 401. So logins were sent over a
Chrome-impersonating transport, scoped to the auth calls.

**Then, the same day:** that came back as a 503. Pinning one impersonation profile is a
bet that Garmin's edge keeps accepting that exact shape, and it is a bet that has to be
re-won every time they change anything. So the bet is off. `garminconnect==0.3.16`
carries five login strategies — iOS mobile over curl_cffi, mobile over requests, the
sign-in widget, and two portal flows — and falls through to the next one on a rate
limit or a bot challenge. Failing needs all five to fail; recovering needs an upstream
release rather than a local guess. It also has no garth dependency at all, and is
maintained.

What the swap cost: the new client refuses a `?` inside an API path (query strings go
in `params`, validated so a crafted path cannot escape the API host), so `fetch()`
splits the two — see `connect.split_query`. Endpoint literals are unchanged. The token
cache changed format and filename (`garmin_tokens.json`); an old garth cache does not
read as connected, by design, so the failure lands on the setup screen rather than
mid-sync. Python floor moved to 3.12, which is garminconnect's; the image was already
there.

**What it did not fix.** Verified from this host on 2026-09-23 with invented
credentials: all five strategies failed — 429 on both mobile routes, 403 Cloudflare on
both portal routes. That is Garmin blocking this IP, not the library. The browser-ticket
login (D44, below) is still the way in from this box. The migration bought a login
that recovers on its own when the block lifts, not a way through the block.

### D4 — raw-first via `connectapi()`, not the client's typed models
Both garth and garminconnect expose typed models (`SleepData`, `DailyHRV`, …) that drop
fields Garmin returns but the library does not model. The spec's non-negotiable #2 says
never discard. So ingestion calls `connectapi()` and archives the verbatim JSON into
`raw_documents`, then normalises out of that. Re-parsing never needs re-fetching — and
it is why the library swap above did not touch a single stored row.

### D5 — TRIMP from HR-zone dwell times, falling back to average HR
Banister TRIMP is exponential in heart-rate reserve, so applying it to a session's
mean HR systematically under-counts intervals. Where zone time exists, TRIMP is summed
per zone using the zone midpoint HRr; where it doesn't, the classic single-average-HR
form is used. Both are in `analytics/load.py` and both are unit-tested.

### D6 — same-day TSB
TSB is reported as `CTL − ATL` for the same day. TrainingPeaks uses yesterday's values.
The difference is a one-day shift and is stated in the README rather than silently
chosen.

### D7 — readiness is a renormalised weighted sum
Sleep 0.30, HRV 0.25, TSB 0.25, RHR 0.20. Components with no data are dropped and the
remaining weights renormalised, so a missing HRV night lowers confidence rather than
scoring a hard zero. Every component emits its own sentence; the API returns them.

### D8 — Riegel projection uses the *longest* qualifying recent best
Projecting a half marathon from a 1 k best flatters badly. `project_race_time` picks
the longest best effort at or under the race distance from the last 120 days, and falls
back to all-time only if the recent window is empty. The source effort is returned
alongside the projection so the number is auditable.

### D9 — SQLite, single file, no migrations framework
One `schema.sql` of `CREATE … IF NOT EXISTS` plus a `schema_migrations` table. At
version 1 there is nothing to migrate from; adding a framework now would be ceremony.

### D10 — uPlot 1.6.32 vendored from the npm registry tarball (MIT)
51 KB minified IIFE + 2 KB CSS, copied into `garmin_analytics/web/vendor/` with its
LICENSE. No CDN, no `node_modules`, works offline. Chosen over Chart.js/ECharts purely
on size.

**Superseded by D45** — uPlot went with `web/`; charts are ECharts, installed from npm.

### D11 — synthetic data is generated, not fetched, and is clearly labelled
`seed/synthetic.py` writes `source='seed'` on every raw document and tags the DB.
`doctor` and the dashboard both report when the database is synthetic, so nobody
mistakes a demo chart for their own training.

The dashboard half went with `web/` (D45); `synthetic` is still in `/api/health` and
`/api/summary` for the rebuilt UI to show.

### D12 — no browser stack downloaded
Playwright and friends are ~400 MB and the disk was tight. Decided not to install one:
dashboard verification would be the page plus every endpoint it calls, asserted against
the served HTML and JSON. **Superseded by D22** — Chromium turned out to be already
installed, so the dashboard is verified in a real browser after all, at zero download
cost. The contract-level checks were kept as well, and still run where Chromium is
absent. **Both superseded by D45**, which deleted the dashboard they checked.

### D13 — ingestion is tested against handcrafted inputs, and the live SSO path is not
tested at all
No Garmin credentials exist tonight. `tests/fixtures.py` holds payloads written by hand
to the documented and commonly-observed Connect shapes; the sync loop runs against an
injected fetcher rather than the network. The FIT path is the exception and is genuinely
end-to-end: `tests/fitgen.py` *writes* a real FIT binary (header, definition and data
messages, both CRCs) which the real `fitdecode` then parses — fitdecode cannot write,
and there was no real file to borrow. A real Garmin login is **not** exercised — the
closest thing to it is the strategy-exhaustion probe recorded in D3, which reached
Garmin's edge and was refused by it. Flagged in HANDOVER as the main unknown.

**Since 2026-09-23** a real account has been synced: 487 activities back to December
2022, with the activity, sleep and GPS-stream parsers checked against the real
payloads. It turned up two bugs no fixture had: an HRV day Garmin returns as `{}` was
filed as a row with no measurement, and a short test sync moved every watermark to
today, stranding the history behind it (hence `sync --full`). The handcrafted fixtures
are still the test suite; the live path is not part of `pytest`.

### D14 — activity sample streams are stored, downsampled to 10 s
Full 1 Hz streams for 400 activities would be ~5 M rows. 10 s samples keep best-effort
extraction accurate to a few seconds and decoupling essentially exact, at ~90 k rows.
The resample interval is a constant (`SAMPLE_INTERVAL_S`), not a magic number.

### D15 — the seeder lives inside the package, not at the repo root
The spec's tree puts `seed/synthetic.py` at the top level. It is at
`garmin_analytics/seed/synthetic.py` instead, so `pip install .` ships it, the CLI can
import it without path games, and the tests can use it as a fixture. Same file, one
directory deeper.

### D16 — the over-training flag is on the CTL ramp, not on raw weekly load
First cut flagged any week whose TRIMP rose more than 10 % on the previous week. Against
a 3-weeks-build / 1-week-recover mesocycle that fired on 35 of 79 weeks — the recovery
week drops ~30 %, so the week after it always rebounds ~40 %. The flag now watches
week-on-week CTL, which is what "ramp rate" means in the literature. It now fires only on
the genuine cold-start ramp, which is itself surfaced as `warmup_until`.

### D17 — aerobic decoupling uses a time-weighted mean HR
A plain mean over samples over-weights densely sampled stretches (auto-pause, GPS
dropouts make real streams irregular) and counts the midpoint sample fully into both
halves. Each half now integrates HR over elapsed time. A test asserts that doubling the
sample rate in one stretch does not move the answer.

### D18 — race-panel notes carry their own severity from the API
The frontend originally guessed severity from the wording, which read "CTL is already
above target" — unambiguously good news — as a warning, because the string contains the
word "above". Each note is now `{level, text}` and the frontend renders what it is told.

### D19 — the sleep-stage chart shows 120 nights, not 550
550 stacked bars across ~1100 px is one bar per two pixels: the result reads as texture,
not as composition. The long series is still available as numbers in the monthly table
and through `/api/daily`.

**Superseded by D45** — that chart went with `web/`; the rebuilt Health view makes its
own call.

### D20 — weekly volume is anchored on a trailing 28 days, not four calendar weeks
"Last four weeks" includes the current, incomplete week, so on a Tuesday the race panel
reported a 25 % volume collapse that was really just a Tuesday. `trailing_weekly_km`
anchors on the last activity and divides by the window.

### D21 — `run_km` is reported separately from `km`
Weekly totals were summing all sports, so a 40 km bike ride showed up as running volume
and a "71 km week" was really 45 km of running. Both numbers are now reported and
labelled; the charts and the race target use `run_km`.

### D22 — Chromium was already installed, so the dashboard is verified in a real browser
The spec said not to install a 400 MB browser stack. `/usr/bin/chromium-browser` was
already present (a snap), so `--dump-dom` and `--screenshot` cost nothing. The dashboard
checks therefore assert on a genuinely rendered DOM — JS bootstrapped, uPlot canvases
drawn, no error banner — across all six tabs. Where Chromium is absent the tests skip
rather than fail, and the contract layer (every id exists, every endpoint returns 200)
still runs. Note: the snap cannot write screenshots into `/tmp`; they go under `$HOME`.

**Superseded by D45** — the headless tests and the screenshots were deleted with the
dashboard. There is no browser-level check of the new UI yet.

### D23 — three real bugs found by the tests, listed here rather than quietly fixed
1. `normalize_weight` took `(payload)` while the sync loop calls every normaliser as
   `(payload, day)`. The `body` endpoint would have raised `TypeError` on the first real
   sync.
2. The GDPR export nests activities as `[{"summarizedActivitiesExport": [...]}]`; the
   flattener only unwrapped the outer list, so no activity would ever have imported.
3. Undecodable ZIP members were skipped silently. They are now counted and reported.

All three were in code paths that cannot be exercised without real Garmin data, which is
exactly why they were worth writing fixtures for.

### D24 — `scripts/verify.sh` refuses to run against a busy port
A leftover server from an earlier run answered every curl in the first transcript, so the
document described the wrong process — including a "shutdown" section where the service
was still up. The script now checks the port first and kills by recorded PID rather than
by pattern (a `pkill -f` on the process name also matches the script's own command line,
which killed the shell running it).

---

# v2 decisions

The brief changed a few hours in: from a personal script to a shareable, Docker-
deployed web product with routes, maps, an editing layer and gear. These are the calls
made for that, again without asking.

### D25 — overrides are a separate table, not columns on `activities`
The requirement is that a sync can never clobber a user edit. Two ways to do that:
be careful in the sync path, or make it structurally impossible. Columns on
`activities` mean every present and future write path has to remember to preserve
them — one `upsert` with the full row and the edit is gone.

So: `activities` holds what Garmin said, `overrides` holds what the user said, and a
generated view resolves `COALESCE(override, garmin_value)`. Sync writes one table, the
user writes the other, and there is no code path that touches both. The cost is a
six-way `LEFT JOIN` in the read path, which on a few thousand activities is free.

### D26 — the editable-field registry generates the view DDL
The brief asked that another editable field be "a small change, not a refactor". So
`db/fields.py` holds a list of `EditableField`s and *generates* the `v_activities`
DDL, the API schema, the validation and the UI editor from it. Adding a field is one
entry.

The trap with a generated schema is drift: change the registry, forget to migrate, and
the view silently no longer matches. `PRAGMA user_version` therefore stores a
fingerprint mixing `SCHEMA_VERSION` with a digest of the registry, so a registry change
invalidates the stored schema automatically and the view is rebuilt on next open.

### D27 — migration is skipped entirely when the fingerprint matches
v1 ran the whole DDL script on every `Store.open()`, and the API opens a connection
per request. Adding `DROP VIEW`/`CREATE VIEW` to that made it a *write* on every
request, and two concurrent requests dropping the same view is a write-lock race. It
showed up as two intermittently failing dashboard tests before I understood it.

Now: `PRAGMA user_version` is one integer read; if it matches, `migrate()` returns
immediately and touches nothing.

### D28 — route matching is symmetric overlap, and the minimum of the two directions
Comparing tracks by start/end proximity plus total distance merges any two loops of
similar length from the same house. Comparing by mean nearest-neighbour distance lets
a 5 km out-and-back match the 10 km route that contains it, because every one of its
points really is on that route.

Taking `min(fraction of A within tolerance of B, fraction of B within tolerance of A)`
fixes the subset case: the long route scores badly against the short one. Tolerance is
45 m — enough for GPS drift and opposite pavements, not enough to merge parallel
streets. Threshold 0.80. On the synthetic seed this produces exactly the 15 routes the
generator used, with no false merges, including two pairs deliberately built at the
same distance in different parts of the city.

### D29 — tracks are resampled by distance, not by time
So that a slow run and a fast run of the same loop produce the same point sequence.
Time-based resampling makes pace a confounder in a geometry comparison.

### D30 — the representative track for a route is the median-length attempt
Not the first (arbitrary), not an average of all attempts (an average of GPS tracks
is a smear that corresponds to no real path). The median attempt is robust to one run
where the signal wandered, and it is always a track the user actually ran.

### D31 — segment speed is normalised by each attempt's own average
"Where do I slow down" must not answer "on the days you were tired". Dividing each
segment's speed by that attempt's mean speed before aggregating across attempts
removes the day-to-day fitness signal and leaves the route's own profile. Verified on
the seed: the segments flagged slowest are exactly the ones with a +3.3 % gradient,
and heart rate rises across them.

### D32 — the heatmap is hand-rolled canvas, not `leaflet.heat`
One more vendored dependency for one view. It is ~70 lines: stamp radial gradients
into an accumulation buffer, then map the buffer through the same colour ramp the
polylines use. Aggregation happens server-side onto a grid, so the browser receives
tens of thousands of counted cells rather than millions of raw points.

**Superseded by D45** — the canvas went with `web/`, and deck.gl's aggregation layers
are the frontend's dependency for this now. The server-side grid (`/api/heatmap`) is
unchanged.

### D33 — chart↔map hover is matched on elapsed time, not array index
The chart plots every sample; the track only the samples that carried a position.
Indexing one array with the other's index is the obvious implementation and it
silently mis-aligns wherever GPS dropped out. Binary search on elapsed time instead.

**Superseded by D47** — `/streams` gives the map and the charts the same arrays, with
null lat/lon where GPS dropped out, so the index is the match.

### D34 — indoor activities keep their own activity type
v1's `TYPE_MAP` folded `treadmill_running` into `running` and `indoor_cycling` into
`cycling`. They have no GPS, no elevation and a different pace profile; folding them
together distorts every per-type average and removes the user's ability to filter them
out. They are still runs, but they are not the same runs. The seeder deliberately
produces ~9 % treadmill runs and ~22 % indoor rides so the no-GPS path is always
exercised.

### D35 — gear mileage excludes activities flagged exclude-from-stats
The watch left running in the car should not retire your shoes. Same view
(`v_activities_included`) as every other aggregate, so there is one definition of
"counts" rather than two.

### D36 — a single `APP_PASSWORD`, no user accounts
Single-tenant was the brief. A login system implies user records, password resets and
a session model per user; none of that adds safety for one person, and all of it adds
surface. One password, PBKDF2 at rest, session tokens stored as hashes so a copy of
the database cannot be replayed. Sessions live in the database so a container restart
does not sign you out.

Empty `APP_PASSWORD` runs unprotected and says so loudly in the logs, in `/api/config`
and on the Settings tab. Forcing a password on someone running it on a laptop would
just make them set `APP_PASSWORD=x`.

### D37 — Garmin credentials go through the web UI, never through env or the image
`garminconnect` supports `Garmin(..., return_on_mfa=True)`, which returns instead of
prompting on a TTY. That makes a real MFA pause possible in a browser. The pending
challenge lives on the client instance, so that instance *is* the in-flight state: it
is held in memory with a 10-minute expiry and never written to disk — an auth context,
not a preference. (One consequence: the two halves of an MFA login must reach the same
worker process. Single-tenant, one uvicorn worker, so they do.) The password is used once and discarded;
`.env.example` deliberately has no `GARMIN_PASSWORD` line to copy.

The setup screen went with `web/` (D45); the endpoints are unchanged, and until the
Settings view is rebuilt `garmin-analytics login` does the same job.

### D38 — backfill state lives in the database, not in the process
The work queue is a query ("which activities have no stream yet"), and progress is
checkpointed after every activity. That makes resume exact and free: there is nothing
in memory to lose. The background job is a plain thread with a stop flag, because
single-tenant means at most one backfill matters at a time and a task queue would be
infrastructure bought for nothing.

### D39 — `GA_SEED_DEMO` is opt-in, and off by default
`docker compose up -d` showing an empty dashboard is a bad first impression; a real
deployment silently filling with fabricated activities is much worse. Off by default,
on in `.env.example`'s commentary, only ever runs when no database exists, and the UI
carries a banner while synthetic data is present.

The banner went with `web/` (D45); see D11 for where the flag still is.

### D40 — `renormalize` now rebuilds `activities` too
It previously covered only the per-day endpoints, which meant the offline re-parse
could not rebuild the largest table — and, more to the point, there was no honest way
to *prove* the override-survival claim without network access. It now re-normalises
every archived activity payload, which is the same write path a sync takes. That is
what section 7 of `VERIFICATION.md` exercises. (That transcript was removed on
2026-09-23 with the dashboard it described; git history keeps it.)

### D41 — average pace is distance-weighted
Total distance over total time, not the mean of per-activity paces. The two differ,
and the mean lets a 1 km jog count as much as a 30 km long run. Where the filter spans
several sports the UI says "mixed sports — filter by type" rather than presenting a
number that averages running and cycling.

### D42 — four bugs found by rendering the dashboard rather than asserting about it
Listed rather than quietly fixed, because they are the argument for looking:

1. `baseOpts` already prepends the x-series, so the leading `{ label: … }` I copied
   into every new chart gave each one more series than data arrays. All six aggregate
   charts and the segment profile drew blank.
2. The segment profile shared one y-axis between relative speed (±10 %), gradient
   (±5 %) and heart rate (120–180 bpm). At that scale the percentages were a flat
   line. Split into two charts.
3. The activity-type `<select>` only contained values from the suggestion list, so a
   strength session displayed "running" — and Save would have silently retyped it.
   The select now always contains the activity's real value.
4. Leaflet caches the container size at creation, and the drawer keeps growing after
   the map is inserted. `invalidateSize()` after the drawer finishes.

The code these were in was deleted with `web/` (D45); the list stays as the argument.

And one found by writing the verification script carefully: the gear-mileage
comparison passed while both sides were empty strings, because the embedded Python had
a quoting error. `check()` now fails on an empty value rather than comparing `""` with
`""` and reporting success.

### D43 — review findings left unfixed on purpose
From the adversarial review of 2026-09-22 (`REVIEW.md`, removed on 2026-09-23 with the
build it described; git history keeps it). Its fixes are in the code with regression
tests (`tests/test_review_*.py`). Of the seven things it found and left alone, three
are in the README's honest limits (no brute-force lockout, `TZ`, synchronous
re-cluster). The other four, still true:

1. **Garmin's login error is returned verbatim** (`Garmin login failed: {exc}`). It is
   how a user tells a wrong password from an unapproved device. Upstream puts the URL
   and status in it, not the request body — upstream's behaviour, not something this
   code enforces. Logging the detail and returning a fixed string is the hardening to
   consider if anything here changes.
2. **Deleting an activity cascades its overrides away** (`ON DELETE CASCADE`).
   Unreachable: nothing deletes from `activities`, so an activity removed on Garmin's
   side persists locally. Orphaned override rows would be worse; a soft delete is a
   schema change.
3. **`bulk_assign` replaces an earlier assignment of the same kind by default.** "Every
   run that spring was the Novablasts" usually means replace; `only_unassigned=True` is
   the additive mode and the dry run shows the count first. Pinned by
   `test_bulk_replaces_an_earlier_manual_choice_by_default`.
4. **`performance.personal_bests` and `aggregate.records` are two implementations** of
   the best effort at each distance. They agree on sport and exclusion filtering and
   each has a test, but they will drift if one is changed alone.

---

# 2026-09-23 decisions

A real Garmin account, then a new frontend. The old dashboard (`garmin_analytics/web/`)
was deleted and is being replaced view by view.

### D44 — the browser-ticket sign-in, for when Garmin refuses every scripted login
Garmin's web sign-in sets its cookies from JavaScript, so a browser has to do that half.
But the CAS service ticket it hands back (`?ticket=ST-…` in the address bar) exchanges
for OAuth tokens over an ordinary API call, and that works from a server. So
`login --signin-url` prints the URL, the user signs in wherever they like, and
`login --ticket` (or `POST /api/garmin/ticket`) finishes it. Nothing about it depends on
Garmin accepting this host's sign-in, which D3 showed it may not.

A ticket is valid only for the service URL it was issued for, so the sign-in URL and
the exchange are built from one constant (`SIGNIN_SERVICE_URL`) and a test asserts they
agree. The library's fallback to a cookie session is not used: the token cache
serialises only the DI tokens, so that path would have saved a file of nulls and
reported success. No DI token after the exchange is an error, not a saved cache.

### D45 — a React SPA replaces the vanilla-JS dashboard
The UI is map- and analytics-heavy and is going to keep changing; untyped ES2020 over
hand-vendored uPlot and Leaflet was the wrong base for that. The new one is in
`frontend/`: React 19, TypeScript 5.9 with `strict` and `noUncheckedIndexedAccess`
(ESLint forbids `any` and non-null `!`), Vite, Tailwind v4 and shadcn/ui, TanStack
Query for server state, Zustand for UI state, ECharts through echarts-for-react, and
react-map-gl with deck.gl and turf for maps.

React 19 rather than 18 because it is the newest React every map and chart dependency
declares support for. TypeScript 5.9, not 6, because openapi-typescript peers on `^5`.

This drops the "vendored, no CDN, no `node_modules`" rule: the frontend is built from
npm against a lockfile, in a Node stage of the Docker build, and nothing is fetched at
runtime except the basemap (D48). The headless-Chromium dashboard tests and the
screenshots went with `web/`. The frontend is checked by `tsc`, ESLint and vitest; no
view is checked in a browser, because no view exists yet.

### D46 — API types are generated from OpenAPI, so the API declares response models
`npm run gen:api` writes `frontend/src/api/schema.ts` from `/openapi.json`, and it is
committed so a build never needs a running backend. That is only worth having if the
schema describes real shapes, so `api/schemas.py` declares Pydantic response models —
for the activity endpoints first, more with each view. Operation IDs are the handler
names, so the generated types read `api_activities`.

The models sit at the response boundary and nowhere else. A field the model does not
declare is not serialised, which is the point: the API changes only on purpose.
Values keep the units they are stored in. Ingestion and analytics are untouched. The
preformatted `time`/`pace` strings on best efforts and km splits were dropped — the
numbers they came from are still there — and formatting lives in
`frontend/src/lib/format.ts`, the only place a number becomes a string.

### D47 — per-sample streams are columnar, at their own endpoint
`GET /api/activities/{id}/streams` returns one array per channel, one entry per stored
sample, with lat/lon `null` where there was no GPS. The map and the charts index the
same arrays, so a hover on either is an index into both, and D33's elapsed-time search
is no longer needed. The detail endpoint no longer carries `samples`, so a page that
wants the summary does not pay for the stream.

### D48 — basemap: MapLibre with configurable styles, Mapbox when a token is set
Replaces the "offline assets, OSM raster tiles the one exception" rule. Maps render
with MapLibre from the style URLs in `VITE_MAP_STYLE_LIGHT` / `VITE_MAP_STYLE_DARK` —
by default CARTO's free positron and dark-matter styles, which need no key. With
`VITE_MAPBOX_TOKEN` set, Mapbox styles are used instead. Pointing the style URLs at
your own server keeps the basemap local. `GA_TILE_URL` and `GA_TILE_ATTRIBUTION` are
gone, and so is `map` from `/api/config`. The settings are baked in at build time, so
the Dockerfile's UI stage takes them as build args, forwarded by compose from the root
`.env`; an empty one is unset rather than passed as `""`, so the default style holds.

A Mapbox `pk.` token is public by design and ends up in the JavaScript bundle. Restrict
it by URL in the Mapbox account; that is the only protection it has.

### D49 — FastAPI serves the SPA from the package, same origin, no CORS
`npm run build` writes to `garmin_analytics/ui/` (gitignored). FastAPI serves
`/assets/*` as static files and answers any other non-`/api` GET with `index.html`, so
client-side routes such as `/login` and `/activities/123` work; a mistyped `/api/...`
stays a JSON 404. Without a build those pages answer 503 with the command to run, and
the API is unaffected. In development Vite proxies `/api` to `VITE_API_URL`.

Either way the browser sees one origin: the `ga_session` cookie keeps working as
`SameSite=Lax`, and there is still no CORS middleware to get wrong.

### D50 — activity cards: Mapbox static images, routes simplified on the server (2026-10-08)
The activity list became cards, each with the route beside it (T33). A live map per
card is out: 50 WebGL contexts on one page is past the ~16 a browser allows. Each card
is one `<img>` from Mapbox's Static Images API instead, the route drawn by Mapbox in
the sport's colour on the theme's style, with the token the app already has.

The track goes out as a Google encoded polyline, Douglas–Peucker simplified to at most
150 points (`api/preview.py`): about 1 KB, well inside the API's 8 KB URL limit, and
finer than a 240 px card can show. Simplifying costs ~0.3 s for a page of 50 on this
box, so the result is cached in the server process, keyed by the GPS point count,
which a re-sync of the samples changes.

The routes are **not in the list response**. With them in it, a page not seen before
took 0.25–0.4 s and nothing was drawn until it arrived. The list says only `has_gps`
(one indexed count, ~50 ms for the page), the cards draw at once with a placeholder
where the map goes, and the page then asks `GET /api/activities/previews?ids=…` for
that page's routes; each image fades in once loaded.

Mapbox's logo and attribution are turned off on the images, where they would sit on a
small route, and given once under the list. Without a token the card draws the same
polyline as an SVG trace, so the list works on MapLibre setups too. Images are lazy and
the browser keeps them for 12 hours (Mapbox's `max-age`); Mapbox's free tier is 50,000
static images a month.

### D51 — the analytics cache lasts until the data changes, and is warmed (2026-10-08)
The cache behind Status, Trends, Reports and the Map's heatmap expired after 30 s, so a
visit more than 30 s after the last one recomputed the heatmap (~1–1.5 s on the real
history) although nothing had changed. The 30 s was there because the key was the
database file's mtime, and in WAL mode a commit does not touch the main file.

The version is now the main file's mtime plus the WAL's size and mtime, so every commit
moves it and nothing else does. An empty WAL is left out: SQLite deletes the WAL when
the last connection closes and the next one recreates it empty, which on a quiet server
is every request. A version change empties the whole cache, which also bounds it.

A background thread (`CacheWarmer`) recomputes the unfiltered heatmap at startup and
whenever the version has changed and then held still for one 15 s poll, skipping while
a sync runs, so a sync's commits cost one warm-up at its end. `GA_CACHE_WARM=0` turns it
off; the tests do.

