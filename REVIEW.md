# Adversarial review

A second pass over the finished build, by a session that did not write it, with a
brief to find defects rather than features: security, the analytics maths, the
override/sync interaction, real-data edge cases, and whether a stranger can actually
clone this and run it.

Everything below was executed, not reasoned about. Where a claim is derived rather
than observed, it says so.

**Result:** 5 defects fixed, each with a regression test that fails without the fix;
7 issues documented and deliberately not fixed; 1 thing that stays unverifiable
without the user's Garmin credentials. `pytest` is green at **669 passed** (was 645;
the 24 new tests are the regressions plus one behaviour-characterising test). The
container builds and runs from clean and is healthy.

---

## Summary

| # | Severity | Area | Finding | Status |
|---|---|---|---|---|
| 1 | **High** | Maths | Every personal best, the records wall and the race projection were taken from bike rides. Projected half marathon: **46:48**. | Fixed |
| 2 | **High** | Overrides | `exclude_from_stats` reached the Aggregates tab and gear mileage only. Training load, all lifetime totals, streaks, weekly volume and decoupling ignored it. | Fixed |
| 3 | **High** | Overrides | The `activity_type` override had the same partial reach: retyping a walk as a run changed one tab. | Fixed |
| 4 | **High** | Packaging | `.gitignore` excluded `.env.example`, so the README quickstart and `docker compose up -d` both fail on a clean clone. | Fixed |
| 5 | Medium | Secrets | A live `APP_PASSWORD` was committed in `HANDOVER.md`. | Fixed |
| 6 | Medium | API | `**payload` splatted into `gear.create()`/`update()` — `{"store": 1}` was an unhandled 500. | Fixed |
| 7 | Medium | Docker | Dockerfile claimed the entrypoint chowns `/data`. It cannot; bind mounts fail with a bare `Permission denied`. | Fixed (message + docs) |
| 8 | Medium | Security | No brute-force lockout on the login endpoint. | Documented |
| 9 | Medium | Correctness | Everything anchored on "today" used the container clock (UTC). | Documented + `TZ` shipped |
| 10 | Low | Gear | `bulk_assign` overwrites an earlier manual assignment by default, contradicting the module docstring. | Docstring corrected, behaviour pinned by test |
| 11 | Low | Performance | `POST /api/routes/recluster` runs synchronously and superlinearly. | Documented |
| 12 | Low | Overrides | Deleting an activity row cascades its overrides away. | Documented — no code path deletes activities |

---

## 1. Security

Audited by reading the auth and API layers and then attacking a live instance
(`/tmp/probe_sec*.py`, not committed). **No exploitable defect found.** The specific
things checked, and what was observed:

**Password at rest.** PBKDF2-HMAC-SHA256, 240 000 rounds, 16-byte random salt per
password, compared with `hmac.compare_digest`. Only `auth.password_hash`,
`auth.password_salt` and `auth.password_source` reach `app_settings`; the plaintext
is read from the environment once at startup and never written. Verified.

**Sessions.** 256-bit `secrets.token_urlsafe` token; only its SHA-256 is stored, so a
stolen copy of the database cannot be replayed as a live session — confirmed by
querying `sessions` for the raw cookie value and getting zero rows. Cookie is
`HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` under `GA_COOKIE_SECURE=1`.

* Session fixation is structurally impossible: tokens are minted server-side on
  successful login and the client cannot propose one.
* Expiry is enforced on read, not just at issue — an expired row gives 401.
* Rotating `APP_PASSWORD` deletes every session row; the old cookie then 401s and the
  old password no longer authenticates. Verified end to end.
* Logout deletes the row, not just the cookie.

**Authorisation gate.** Everything is gated except `/api/health`, `/api/auth/*`,
`/login`, `/favicon` and `/static/`. Confirmed by request: `/api/summary`,
`/api/activities`, `/api/config`, `/api/doctor`, `/api/raw/...`, `/api/sync/start`
and `/api/garmin/login` all 401 without a session; `/` 302s to the login page.
`/static/` serves the dashboard shell to anyone, which is markup with no data in it.

**CSRF.** No token, and none needed here — three independent things stop a
cross-origin state change, and all three were checked:

1. `SameSite=Lax` means the cookie is not attached to a cross-site POST/PATCH/PUT/DELETE.
2. There is no CORS middleware, so a cross-origin `fetch` with `application/json` fails
   its preflight.
3. Every state-changing endpoint takes a JSON body. A form-encoded POST — the only
   kind an HTML form can send without preflight — returns 422. Verified against
   `/api/gear`.

No state-changing endpoint is reachable by GET.

**The Garmin credential path.** The password is a parameter to `garth.login()` and
nothing else. It is not stored, not logged, not written to the database, and not in
any git-tracked file. The one place it could plausibly escape is
`HTTPException(502, f"Garmin login failed: {exc}")` in `api_garmin_login`, which
returns the upstream exception verbatim. Probed with a throwaway credential: the
response contained the SSO URL and the HTTP status, not the password. That is
`garth`'s behaviour today, not a guarantee this code enforces — noted under "not
fixed" below. MFA `client_state` is held in a module-level dict with a 600 s TTL and
never touches disk, which is correct.

**Token cache.** `secure_token_dir()` sets 0700 on the directory and 0600 on every
file, called after each of `login`, `begin_login` and `finish_login`. The entrypoint
also chmods 0700 before the app starts.

**SQL injection.** Every query in the codebase was traced. All user-supplied *values*
are bound parameters. The only interpolated identifiers are: `sort`/`order` in
`/api/activities` (allowlist + regex — `?sort=day; DROP TABLE activities` returns
400), the heatmap `precision` (typed `int`, `ge=2 le=6`), and the aggregate period
expression (a three-key dict lookup). `store.upsert()` interpolates column names that
callers construct, never request keys. Live probes with `' OR '1'='1`,
`'; DROP TABLE activities;--`, `%' --` and a UNION attempt across `q`, `type`,
`start`, `end` and `sort`: no injection, no dropped tables, `?q=' OR '1'='1` returns
0 of 48 rows as a literal `LIKE` would.

**Path traversal.** There is no file-upload endpoint; `import-zip` and `import-fit`
are CLI-only. `export_zip.py` reads members with `zf.open(info)` in memory and never
extracts to disk, so Zip Slip does not apply. Static files are served by Starlette's
`StaticFiles`. Traversal probes against `/static/`, `/api/raw/` and
`/api/activities/` all 404.

**XSS.** Every user-controlled string in the dashboard — activity titles, notes, gear
names, route names — is rendered through `textContent` or
`document.createTextNode`. There are exactly three `innerHTML` sinks: the `el()`
helper's `html:` attribute, which **no call site uses**; the uPlot tooltip, which
interpolates static series labels and formatted numbers; and the map legend, which
interpolates strings from the source. Round-tripped
`🏃 <script>alert(1)</script> «Ünïcødé»` and `<img onerror=x>` through activity
titles and gear nicknames: stored and returned intact, rendered as text.

**Secrets in git and in the image.** `.env` has never been committed
(`git log --all --full-history -- .env` is empty) and is ignored. A pattern scan of
the whole history found no credential. The image runs as uid 10001, contains no
`.env`, and no layer command mentions a secret. `docker-compose.yml` binds to
`127.0.0.1` and sets `no-new-privileges:true`.

**One real credential exposure, now fixed:** `HANDOVER.md` — a tracked file, headed
for GitHub — printed the running instance's `APP_PASSWORD` in plain text. On a
localhost-bound container that is nearly harmless; published, it is a default
password for every deployment whose owner skipped step 1. Redacted, and
`tests/test_review_packaging.py` now fails if any password value is committed again.

---

## 2. The analytics maths

Re-derived from the references rather than from the existing tests.

**Correct as written** — checked and left alone:

* **TRIMP.** Banister: `duration_min × HRr × 0.64 × e^(k·HRr)`, `k` = 1.92 male /
  1.67 female, `HRr` = (HR − HR_rest) / (HR_max − HR_rest). Clamped to ≤ 1, returns
  0 at or below resting HR, guards `HR_max == HR_rest`. The zone-dwell variant
  applies the exponential per zone, which is more faithful for intervals and is
  documented as an approximation at the zone midpoints.
* **CTL/ATL.** `α = 1 − e^(−1/τ)` with τ = 42 / 7 over a *dense* zero-filled daily
  series, so rest days decay correctly. Seeded at zero, and the API returns a
  `warmup_note` naming the first 42 days as a cold-start artefact rather than
  letting the chart imply fitness. That is the honest choice.
* **TSB** = CTL − ATL, same-day convention, stated explicitly in the module docstring.
* **Ramp rate.** Percent change in CTL over 7 days; returns `None` rather than
  infinity when the earlier CTL is ~0. The weekly over-reaching flag is on the CTL
  ramp, not raw weekly load, which is right — a 3:1 mesocycle makes raw load jump
  40 % by design.
* **Z-scores.** Sample SD (n−1), minimum 2 observations, `None` on zero variance
  (`sd < 1e-9`), and the baseline window **excludes today** so today is scored
  against history rather than against itself. `readiness_history` uses the same
  exclusive window. Insufficient data surfaces as `"insufficient data"`, not as 0.
* **Riegel.** `T2 = T1 × (D2/D1)^1.06`; raises on non-positive inputs; picks the
  *longest* effort at or under the target so a half marathon is not extrapolated
  from a 1 k.
* **Aerobic decoupling.** Split at the elapsed-time midpoint, speed:HR per half,
  **time-weighted** mean HR so irregular sampling and auto-pause do not skew it, and
  the boundary sample is not double-counted. Returns `None` when either half lacks
  usable HR or distance.
* **Best-effort rolling windows.** Two-pointer sweep to the minimal window covering
  the target, with linear interpolation at the entry point so the result is not
  quantised to the sample interval. Handcheck of the interpolation: the entry point
  must sit at cumulative distance `d[end] − target`, i.e. `overshoot/segment` along
  the bracketing segment — which is what the code computes. **A distance the athlete
  never reached returns `None`**, both by the early `d[-1] − d[0] < target` guard and
  by the loop never finding a qualifying span.
* **Gear mileage.** `total = initial_distance_m + Σ distance over included
  activities`; `retirement_pct` and `remaining_m` are both against that total, so the
  initial offset is honoured everywhere. Warns at 85 %.
* **Distance-weighted average pace** (total distance ÷ total time), not the mean of
  per-activity paces.

**Defect found — the big one.**

`best_efforts` rows are extracted from *any* activity with a distance stream, which
is correct. Reading them back without filtering by sport was not. On the seeded
six-month demo, every entry on the Performance tab's personal-bests list belonged to
a bike ride:

```
1 k  1:46/km   5 k  8:59   10 k  18:11   15 k  27:37   HM  39:08     ← all cycling
```

`compute_race()` feeds those bests to the Riegel projection, so the race panel — one
of the spec's headline features, counting down to a real half marathon the user has
entered — confidently promised a **46:48 half marathon**. The world record is 56:42.
The records wall on the Aggregates tab had the same problem whenever no sport filter
was set.

Fixed: `personal_bests()` now joins `v_activities_included` and restricts to
`BEST_EFFORT_TYPES = ("running", "treadmill_running", "walking")`; the records wall
applies the same restriction only when the caller has not asked for a specific sport,
so `?type=cycling` still returns cycling records. After the fix the same dataset
projects **2:11:05** off a 15 k, which is a sane half-marathon prediction.

Regression tests: `tests/test_review_best_efforts.py`.

---

## 3. The override / sync interaction

The spec flagged this as most likely to break silently. It was half right: the write
path is sound and the read path was not.

**Proven sound, no change needed.** The separation genuinely holds. `overrides` is
written only by `edits/overrides.py`; `activities` is written only by ingestion. I
re-ran the claim rather than trusting it: `renormalize()` rewrites every row of
`activities` from the raw archive — the same write path a sync takes — and edits
survive. There is no code path in ingestion that reads, writes or deletes an
override.

**Disproven: "exclude_from_stats removes the activity from every aggregate."**
It removed it from the Aggregates tab and from gear mileage. It did **not** remove it
from:

* the training-load curve — `daily_loads()` summed TRIMP `FROM activities`, so the
  README's own example (the watch left running in the car) fed a large bogus TRIMP
  straight into CTL and distorted the load curve, the TSB, the form label and every
  readiness score for the following six weeks;
* lifetime totals, active days, the weekly and monthly rollups, the streaks and the
  weekday-consistency chart (`reports.py`);
* personal bests (`performance.py`) — so the excluded car journey kept its 5 k record;
* the 28-day rolling running volume and the weekly-distance chart on the race panel
  (`readiness.py`);
* the aerobic-decoupling list.

Measured before/after on a seeded database: excluding the longest run changed exactly
one of seven headline figures.

**Disproven for the same reason: the `activity_type` override.** Retyping a ride as a
run moved 85 km into the running totals on the Aggregates tab and changed nothing in
`reports`, `readiness` or `decoupling_history`, all of which filtered
`activities.activity_type = 'running'` on the raw column.

Fixed by pointing those queries at `v_activities_included`, which is what the view
was built for. Regression tests: `tests/test_review_stats_scope.py`.

**Bulk gear reassign vs per-activity assignments.** Tested: `bulk_assign()` *does*
overwrite an earlier manual assignment of the same kind, by default. The module
docstring claimed the opposite ("a 'manual' row is sacred", guarded by a
`REPLACEABLE_SOURCES` constant that nothing read). I have kept the behaviour —
"every run that spring was the Novablasts" usually does mean "replace what is there",
`only_unassigned=True` is the additive mode, and the UI offers a dry-run Preview
first — but corrected the docstring, deleted the dead constant, and pinned the
behaviour with `test_bulk_replaces_an_earlier_manual_choice_by_default` so it is a
decision rather than an accident. The genuinely automatic paths (`apply_defaults`,
`import_from_garmin`) are purely additive, which is better than the docstring
promised.

**Revert leaves no orphans.** `revert()` and `revert_all()` delete rows from
`overrides`; nothing else references them. Verified.

**A re-sync that deletes the activity.** Overrides are `ON DELETE CASCADE` on
`activity_id` and `PRAGMA foreign_keys = ON` is set, so deleting an activity row does
take its edits with it — confirmed empirically, and re-inserting the same id does not
bring them back. This is not reachable today: nothing in `sync_activities()`,
`renormalize()` or the import paths issues a `DELETE` against `activities`, so an
activity removed on Garmin's side simply persists locally. Recorded under known
issues rather than "fixed", because the alternative (orphaned override rows keyed to
nothing) is worse than the current behaviour.

---

## 4. Real-data edge cases

Constructed each case directly and ran every analytics entry point over it. **No
crashes, and no wrong numbers found.** Specifically exercised:

* **Brand-new account, zero activities and zero wellness days.** `load`, `reports`,
  `performance`, `readiness`, `race`, `aggregate`, `trends` and `routes` all return
  well-shaped empty results. No `IndexError`, no division by zero.
* **Zero distance, zero duration, and all-NULL distance/duration/HR/TRIMP.** Handled.
  `trimp()` returns 0, `efficiency_factor` returns `None`, the histograms drop them,
  `_decorate` guards its divisions.
* **No GPS** (treadmill, pool, indoor bike). `activity_track()` returns
  `has_gps: false` with an empty point list and a null bounding box; the clusterer
  reports `no_gps` and files nothing; the heatmap ignores them. The partial index
  `idx_samples_gps ... WHERE lat IS NOT NULL` is the right shape for this.
* **A single GPS point.** `activity_track` returns one point with valid bounds;
  clustering rejects it on `MIN_POINTS` before any geometry runs.
* **Missing HR.** TRIMP is 0 rather than an error; decoupling returns `None`;
  `rolling_mean` and `zscore` skip `None` values rather than coercing them to 0.
* **Unicode and emoji** in activity titles and gear names, including HTML and quote
  characters, through the override path and the gear path: exact round trip.
* **5 200 activities / 208 000 samples.** Timed every expensive endpoint. No N+1
  blow-up: activities list 0.00 s, `COUNT(*)` through the six-way-join view 0.01 s,
  `compute_load` 0.09 s, `compute_reports` 0.13 s, `compute_aggregate` 0.33 s,
  `compute_performance` 0.50 s, heatmap 0.88 s. The indexes that matter
  (`activities(day)`, `activities(activity_type)`, `activity_samples` PK,
  `best_efforts(distance_m, seconds)`, `route_members(route_id)`) are all present.
  The one slow path is `cluster_all()` at 12.7 s for 520 GPS activities — see known
  issues.
* **Activities crossing midnight / a DST boundary.** Partially checked. `day` is
  stored as the local date of the *start*, which is the convention every training
  platform uses and is internally consistent: a run started at 23:40 counts on the
  day it started. Garmin supplies `startTimeLocal` already converted, so no DST
  arithmetic happens in this codebase at all — there is nothing here that can get a
  DST transition wrong, because nothing here converts. Qatar does not observe DST,
  so this is also not a case the user will hit.
* **Corrupt / truncated FIT files.** Not re-tested — the existing suite already
  covers it (`tests/test_ingest.py` feeds truncated and malformed files through
  `read_fit`) and it is CLI-only, unreachable from the network.

---

## 5. GitHub readiness

**The quickstart did not work from a clean clone.** `.gitignore` line 9 was `.env.*`,
which matches `.env.example`. The file existed on disk, was linked from the README
and the configuration table, and was **never tracked by git**. So step 3,
`cp .env.example .env`, fails; and because `docker-compose.yml` has
`env_file: - .env`, step 5 — `docker compose up -d`, advertised as "the *entire*
install" — then refuses to start. Every stranger cloning this hits it immediately.
Fixed with a negation pattern and by committing the template; `.env` itself is still
ignored and still absent from history, and there are now tests for both directions.

**Otherwise accurate.** The rest of the README was checked claim by claim against the
code. `garth` being unmaintained, the ToS-grey status, the rate limits, the map-tile
exception, the single-tenant scope, the "APP_PASSWORD is not an identity system"
caveat and the data-model table are all true as written. The honest-limits section
has been extended with the three real limitations this review found and did not fix.
The test count was updated from 645 to 669.

The Dockerfile carried one false statement: that the entrypoint chowns `/data`,
"which is what makes a bind mount work as well as a named volume". It does not — the
image sets `USER garmin` before `ENTRYPOINT`, so the process is unprivileged and
cannot chown anything. A named volume works because it inherits ownership from the
image; a bind mount, which is a perfectly normal thing to prefer, fails with a bare
`mkdir: Permission denied` and no explanation. Confirmed by running one. The comment
is corrected and the entrypoint now prints the `chown -R 10001:10001` the operator
needs.

---

## Known issues — found, not fixed

Deliberate. Each one is either a design decision I am not entitled to reverse, or a
fix that would be a feature rather than a repair.

**1. No brute-force lockout on `APP_PASSWORD`.** A wrong guess costs one second of
`time.sleep` and nothing else: no attempt counter, no ban, no backoff. FastAPI runs
sync endpoints in a 40-thread pool, so an attacker gets roughly 40 guesses a second
against a single-password app. The same `sleep` is itself a mild DoS lever — 40
concurrent wrong logins occupy the whole pool. Not fixed because a lockout is a
feature with real design questions (what counter, what window, how does the owner get
back in), and the spec asked for "a single password that stops the container being
wide open", which this is. Mitigation is a long random password and not exposing the
port; both are now in the README's honest-limits section.

**2. The Garmin error is returned verbatim.** `HTTPException(502, f"Garmin login
failed: {exc}")` hands the upstream exception straight to the browser. Probed with a
throwaway credential and the password did not appear — `garth`/`requests` put the URL
and status in the message, not the request body. But that is upstream's current
behaviour, not something this code enforces, and `garth` is unmaintained. A
defensible hardening is to log the detail and return a fixed string; I have not done
it because the verbatim error is deliberate and documented (HANDOVER §2 tells the
user to read it to distinguish a wrong password from an unapproved device), and
degrading it would make the one un-testable part of the app harder to debug.
**If you want one change here, this is the one to consider.**

**3. Everything anchored on "today" uses the container clock.** `date.today()` in
`compute_race` (days-to-go), `aggregate.streaks` (current streak) and
`reports.current_streak`. The container is UTC; you are UTC+3. For the three hours
after Doha midnight, those read the previous day. Not a code fix: `TZ` is the
standard mechanism, the image already ships tzdata and honours it, so `.env.example`
now documents it with `TZ=Etc/UTC` and an explanation. **Set `TZ=Asia/Qatar`.**

**4. `POST /api/routes/recluster` is synchronous and superlinear.** Every GPS
activity is compared against every candidate route inside the request thread: 12.7 s
for 520 tracks here, and the candidate set grows with the history. On a decade of
running it will take minutes and hold a worker the whole time. The backfill already
has the `BackgroundJob` machinery this wants; wiring recluster into it is a
straightforward change, but it is a new behaviour (progress reporting, a stop button,
a status endpoint) rather than a bug fix. Documented in the README instead.

**5. Deleting an activity cascades its overrides away.** Described in §3. Unreachable
today because no code path deletes from `activities`. Left alone: orphaned override
rows would be worse, and a soft-delete is a schema change.

**6. `bulk_assign` overwrites manual gear assignments by default.** Described in §3.
Behaviour kept and now pinned by a test; only the docstring was wrong.

**7. `perf.personal_bests` and `aggregate.records` are two independent
implementations** of "the best effort at each distance". They now agree on sport and
exclusion filtering, and there is a test on each, but they will drift again if
someone changes one. Merging them is a refactor with no user-visible benefit today,
so I have not done it — this is a note for whoever touches them next.

## Not verifiable without credentials

Unchanged from `HANDOVER.md` §6, and this review did not improve on it: the entire
Garmin ingestion path — SSO login, the MFA exchange, activity-list paging, the
per-activity detail and stream parsers, the wellness endpoints, real 429 thresholds
and Garmin's gear API — has still never run against a real account. Everything is
exercised through an injected fetcher over handcrafted payloads. I did not attempt a
real login.

The parsers are the specific risk: field names came from documentation and
observation, not from a captured response. If they are wrong the symptom is empty or
wrong columns, not data loss, because payloads are archived verbatim before
normalisation and `garmin-analytics renormalize` rebuilds every table offline.

Also still unverified: long-running stability, concurrent browsers, ARM builds, and
any database larger than the ~200 MB used for the scale test above.

---

## What was re-verified after the fixes

* `pytest` — **669 passed**, 0 failed.
* `docker compose build` — clean build from the current tree.
* `docker compose up -d` — container healthy, serving on 127.0.0.1:8000, redirecting
  to `/login`, data intact on the existing named volume.
* The race projection on seeded data: **46:48 → 2:11:05**.
* Disk: still ~7 GB free on `/home`; no images belonging to other projects touched.
