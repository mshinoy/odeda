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

### D12 — no headless browser installed
Chromium/Playwright is ~400 MB and the disk has 4.5 GB free. Dashboard verification is
done by fetching the page and every endpoint it calls, and asserting on the served HTML
and JSON (`tests/test_dashboard.py`, transcript in `VERIFICATION.md`). This proves the
data path and the bootstrap contract, **not** that pixels rendered. Stated plainly
rather than implied.

### D13 — ingestion is tested against handcrafted fixtures only
No Garmin credentials exist tonight. `tests/test_ingest.py` feeds `normalize.py` and
`fitfile.py` real-shaped payloads captured from the public API documentation shape and
a synthetic FIT file built with `fitdecode`'s own reader. The live SSO path
(`garth.login`) is **not** exercised. Flagged in HANDOVER as the main unknown.

### D14 — activity sample streams are stored, downsampled to 10 s
Full 1 Hz streams for 400 activities would be ~5 M rows. 10 s samples keep best-effort
extraction accurate to a few seconds and decoupling essentially exact, at ~90 k rows.
The resample interval is a constant (`SAMPLE_INTERVAL_S`), not a magic number.
