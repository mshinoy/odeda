# Decisions

Calls made during the overnight build of 2026-09-22, with reasons. The user was asleep
and explicitly authorised deciding without asking.

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

### D3 — `garth` is deprecated upstream; used anyway
`garth==0.8.0` emits `DeprecationWarning: Garth is deprecated and no longer maintained`
(matin/garth discussion #222). It still works and is what the spec names. Mitigations:
all Connect calls go through one thin adapter (`ingest/connect.py`) that uses
`garth.connectapi()` with literal endpoint paths, so swapping the transport means
rewriting one file; and every payload is archived raw, so a future breakage costs new
fetches, not historical data. Called out in README and HANDOVER.

### D4 — raw-first via `garth.connectapi()`, not garth's typed models
garth exposes typed dataclasses (`SleepData`, `DailyHRV`, …) that drop fields Garmin
returns but garth doesn't model. The spec's non-negotiable #2 says never discard.
So ingestion calls `connectapi()` and archives the verbatim JSON into `raw_documents`,
then normalises out of that. Re-parsing never needs re-fetching.

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

### D11 — synthetic data is generated, not fetched, and is clearly labelled
`seed/synthetic.py` writes `source='seed'` on every raw document and tags the DB.
`doctor` and the dashboard both report when the database is synthetic, so nobody
mistakes a demo chart for their own training.

### D12 — no browser stack downloaded
Playwright and friends are ~400 MB and the disk was tight. Decided not to install one:
dashboard verification would be the page plus every endpoint it calls, asserted against
the served HTML and JSON. **Superseded by D22** — Chromium turned out to be already
installed, so the dashboard is verified in a real browser after all, at zero download
cost. The contract-level checks were kept as well, and still run where Chromium is
absent.

### D13 — ingestion is tested against handcrafted inputs, and the live SSO path is not
tested at all
No Garmin credentials exist tonight. `tests/fixtures.py` holds payloads written by hand
to the documented and commonly-observed Connect shapes; the sync loop runs against an
injected fetcher rather than the network. The FIT path is the exception and is genuinely
end-to-end: `tests/fitgen.py` *writes* a real FIT binary (header, definition and data
messages, both CRCs) which the real `fitdecode` then parses — fitdecode cannot write,
and there was no real file to borrow. `garth.login` is **not** exercised. Flagged in
HANDOVER as the main unknown.

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
