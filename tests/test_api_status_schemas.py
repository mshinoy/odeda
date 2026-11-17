"""The Status-page endpoints: typed, and unchanged except for what was meant to change.

Same approach as `test_api_schemas.py`: rebuild each pre-typing payload from the
functions the old handlers called and compare type-strictly. Each payload may differ
from the old one only by the drop/add lists below, where each added key is the raw
number behind a dropped preformatted string.
"""

from __future__ import annotations

import json
import sqlite3
from datetime import date, datetime
from typing import Any, get_args

import pytest
from fastapi.testclient import TestClient

from odeda import __version__, config
from odeda.analytics import aggregate as agg_mod
from odeda.analytics import load as load_mod
from odeda.analytics import performance as perf
from odeda.analytics import readiness as ready_mod
from odeda.analytics import reports as reports_mod
from odeda.analytics import trends as trends_mod
from odeda.api import auth as auth_mod
from odeda.api import schemas
from odeda.api import cache as cache_mod
from odeda.api.server import create_app
from odeda.db.store import Store
from odeda.ingest import backfill as backfill_mod
from odeda.ingest import connect as connect_mod
from odeda.seed import synthetic
from test_api_schemas import _as_json, _strict_equal

#: Preformatted strings dropped from a race projection, and the raw key added so the
#: one of them that had no raw number behind it (`from_time`) can be rebuilt.
DROPPED_PROJECTION_KEYS = {"from_time", "projected_time", "projected_pace"}
ADDED_PROJECTION_KEYS = {"from_seconds"}
#: `time` / `pace` strings on each of the race panel's recent bests (`seconds` stays).
DROPPED_PERSONAL_BEST_KEYS = {"time", "pace"}
#: The summary's race block gains the race distance, so `projected_seconds` can be
#: turned into a pace without a second request.
ADDED_SUMMARY_RACE_KEYS = {"distance_m"}
#: Gym sessions and sets this week (T17), read from the raw payloads (`api/gym.py`).
ADDED_SUMMARY_KEYS = {"gym"}
#: The "0:01:30" rendering of `eta_s`.
DROPPED_SYNC_STATUS_KEYS = {"eta"}
#: Light sleep, joined onto each `/api/daily` row from `sleep` (T08). `v_daily` carries
#: deep and REM but not light, and a sleep-stage chart stacks all three.
ADDED_DAILY_KEYS = {"light_s"}
#: `analytics/aggregate` renders some of its own numbers; T10a drops the renderings and
#: keeps the numbers. Each set below is one such pair of places.
DROPPED_TOTALS_KEYS = {"avg_pace"}                 # `avg_pace_s_per_km` stays
DROPPED_BEST_EFFORT_KEYS = {"time", "pace"}        # `seconds` and `distance_m` stay
DROPPED_EXTREME_KEYS = {"display"}                 # `raw` and `key` stay
DROPPED_BUCKET_KEYS = {"label"}                    # `lo` and `hi` stay


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _fresh_cache():
    """The analytics cache is module-global; never let one test's DB serve another."""
    cache_mod.clear()
    yield
    cache_mod.clear()


@pytest.fixture
def rw_settings(seeded_db, settings):
    """A private, writable copy of the seeded database."""
    settings.ensure_dirs()
    src = sqlite3.connect(seeded_db.db_path)
    dst = sqlite3.connect(settings.db_path)
    src.backup(dst)
    src.close()
    dst.close()
    return settings


@pytest.fixture
def empty_settings(settings):
    Store.open(settings).close()      # the schema, not one row
    return settings


@pytest.fixture(params=["seeded", "empty"])
def db(request) -> Any:
    """Every equality test runs on the seeded copy and on a fresh, empty install."""
    s = request.getfixturevalue("rw_settings" if request.param == "seeded"
                                else "empty_settings")
    return s


@pytest.fixture
def client(db):
    return TestClient(create_app(db))


@pytest.fixture
def st(db):
    s = Store.open(db)
    yield s
    s.close()


# ---------------------------------------------------------------------------
# The pre-typing handlers, verbatim
# ---------------------------------------------------------------------------


def _old_race(st: Store) -> dict[str, Any]:
    return ready_mod.compute_race(st)


def _old_summary(st: Store) -> dict[str, Any]:
    lo, hi = st.day_range()
    ld = load_mod.compute_load(st)
    rd = ready_mod.compute_readiness(st)
    tr = trends_mod.compute_trends(st, days=180)
    rep = reports_mod.compute_reports(st)
    race = ready_mod.compute_race(st)
    latest = st.query("SELECT * FROM v_daily ORDER BY day DESC LIMIT 1")
    return {
        "day_range": {"from": lo, "to": hi},
        "synthetic": synthetic.is_synthetic(st),
        "latest_day": latest[0] if latest else None,
        "readiness": rd,
        "load": ld.get("current"),
        "ramp_pct": ld.get("ramp_pct"),
        "ramp_flag": ld.get("ramp_flag"),
        "warmup_note": ld.get("warmup_note"),
        "flags": tr.get("flags"),
        "totals": rep.get("totals"),
        "streaks": rep.get("streaks"),
        # Mirrors the server: null when the calendar names no race (T57).
        "race": None if race["race"] is None else {
            "name": race["race"]["name"],
            "date": race["race"]["date"],
            "days_to_go": race["days_to_go"],
            "projection": race["projection"],
        },
        "recent_weeks": rep.get("weekly", [])[-8:],
    }


def _old_daily(st: Store, days: int = 400) -> dict[str, Any]:
    rows = st.query("SELECT * FROM v_daily ORDER BY day")
    return {"days": len(rows[-days:]), "rows": rows[-days:]}


def _old_health(st: Store, settings) -> dict[str, Any]:
    """Minus `server_time`, which is the clock and is checked on its own."""
    lo, hi = st.day_range()
    return {
        "status": "ok",
        "version": __version__,
        "db": str(settings.db_path),
        "day_range": {"from": lo, "to": hi},
        "synthetic": synthetic.is_synthetic(st),
    }


def _old_sync_status(st: Store) -> dict[str, Any]:
    out = backfill_mod.status(st)
    out["thread_running"] = False
    out["last_error"] = None
    out["watermarks"] = st.watermarks()
    return out


def _drop(d: dict[str, Any], keys: set[str]) -> dict[str, Any]:
    return {k: v for k, v in d.items() if k not in keys}


def _strip_aggregate(body: dict[str, Any]) -> dict[str, Any]:
    """An aggregate payload with every rendered string removed, so the two sides of
    the comparison differ only where something real changed."""
    out = dict(body)
    out["totals"] = _drop(body["totals"], DROPPED_TOTALS_KEYS)
    for key in ("by_type", "by_year", "by_month"):
        out[key] = [_drop(r, DROPPED_TOTALS_KEYS) for r in body[key]]
    out["year_over_year"] = {
        **body["year_over_year"],
        "years": [_drop(r, DROPPED_TOTALS_KEYS) for r in body["year_over_year"]["years"]],
    }
    out["distributions"] = {
        key: ([_drop(b, DROPPED_BUCKET_KEYS) for b in value]
              if key in ("pace", "distance_km", "duration_min", "avg_hr") else value)
        for key, value in body["distributions"].items()
    }
    out["records"] = {
        "best_efforts": [_drop(e, DROPPED_BEST_EFFORT_KEYS)
                         for e in body["records"]["best_efforts"]],
        "extremes": [_drop(e, DROPPED_EXTREME_KEYS) for e in body["records"]["extremes"]],
    }
    return out


#: The half, as these fixtures put it in the calendar. It was `config.RACE_DISTANCE_M`
#: until T57 made the race the calendar's rather than the build's.
HALF_M = 21097.5


def _check_projection(new: dict[str, Any] | None, old: dict[str, Any] | None) -> None:
    """`new` is `old` minus the strings, plus `from_seconds`, which must be the number
    `from_time` was printed from and the one the projection was computed from."""
    if old is None:
        assert new is None
        return
    assert new is not None
    assert set(old) - set(new) == DROPPED_PROJECTION_KEYS
    assert set(new) - set(old) == ADDED_PROJECTION_KEYS
    _strict_equal(_drop(new, ADDED_PROJECTION_KEYS), _drop(old, DROPPED_PROJECTION_KEYS))
    assert isinstance(new["from_seconds"], float)
    assert perf.hms(new["from_seconds"]) == old["from_time"]
    riegel = perf.riegel(new["from_seconds"], float(new["from_distance_m"]),
                         HALF_M)
    assert round(riegel, 1) == new["projected_seconds"]
    assert perf.hms(new["projected_seconds"]) == old["projected_time"]
    assert perf.pace_str(
        new["projected_seconds"] / (HALF_M / 1000.0)
    ) == old["projected_pace"]


# ---------------------------------------------------------------------------
# Payloads
# ---------------------------------------------------------------------------


class TestPayloadsUnchangedExceptDrops:
    def test_load(self, client, st):
        _strict_equal(client.get("/api/load").json(), _as_json(load_mod.compute_load(st)))

    def test_load_window(self, client, st, db):
        if st.scalar("SELECT COUNT(*) FROM activities") == 0:
            pytest.skip("a window needs activities")
        new = client.get("/api/load?start=2026-08-01&end=2026-08-31").json()
        _strict_equal(new, _as_json(load_mod.compute_load(st, "2026-08-01", "2026-08-31")))

    def test_readiness(self, client, st):
        _strict_equal(client.get("/api/readiness").json(),
                      _as_json(ready_mod.compute_readiness(st)))

    def test_readiness_for_a_day(self, client, st):
        day = st.scalar("SELECT MIN(day) FROM v_daily") or "2026-01-01"
        _strict_equal(client.get(f"/api/readiness?day={day}").json(),
                      _as_json(ready_mod.compute_readiness(st, day)))

    def test_readiness_history(self, client, st):
        _strict_equal(client.get("/api/readiness/history?days=45").json(),
                      _as_json({"days": 45, "series": ready_mod.readiness_history(st, 45)}))

    def test_trends(self, client, st):
        _strict_equal(client.get("/api/trends?days=90").json(),
                      _as_json(trends_mod.compute_trends(st, days=90)))

    def test_trends_for_a_subset_of_metrics(self, client, st):
        new = client.get("/api/trends?days=90&metrics=hrv,resting_hr").json()
        # An empty database answers `{}` whatever was asked for.
        assert set(new["metrics"]) in ({"hrv", "resting_hr"}, set())
        _strict_equal(new, _as_json(
            trends_mod.compute_trends(st, days=90, metrics=["hrv", "resting_hr"])))

    def test_daily_is_unchanged_but_for_light_sleep(self, client, st):
        old = _as_json(_old_daily(st, 45))
        new = client.get("/api/daily?days=45").json()
        assert new["days"] == old["days"]
        assert [set(n) - set(o) for n, o in zip(new["rows"], old["rows"])] \
            == [ADDED_DAILY_KEYS] * len(old["rows"])
        _strict_equal([_drop(r, ADDED_DAILY_KEYS) for r in new["rows"]], old["rows"])

    def test_daily_light_sleep_comes_from_the_sleep_table(self, client, st):
        """The stage the view leaves out, read back per day exactly as stored."""
        stored = {r["day"]: r["light_s"]
                  for r in st.query("SELECT day, light_s FROM sleep")}
        rows = client.get("/api/daily?days=3000").json()["rows"]
        assert [r["light_s"] for r in rows] == [stored.get(r["day"]) for r in rows]

    @pytest.mark.parametrize("query", ["", "?type=running", "?start=2026-01-01"])
    def test_aggregate_is_unchanged_but_for_the_rendered_strings(self, client, st, query):
        f = {"activity_type": None, "start": None, "end": None, "gear_id": None}
        if query == "?type=running":
            f["activity_type"] = "running"
        if query == "?start=2026-01-01":
            f["start"] = "2026-01-01"
        old = _as_json(agg_mod.compute_aggregate(st, **f))
        _strict_equal(_strip_aggregate(client.get(f"/api/aggregate{query}").json()),
                      _strip_aggregate(old))
        # Every dropped string really was dropped, not merely equal on both sides.
        assert "avg_pace" not in client.get(f"/api/aggregate{query}").json()["totals"]

    def test_aggregate_drops_only_strings_a_number_is_already_behind(self, client, st):
        """Each dropped key was `analytics/aggregate` printing a number that stays."""
        old = _as_json(agg_mod.compute_aggregate(st))
        new = client.get("/api/aggregate").json()
        assert set(old["totals"]) - set(new["totals"]) == DROPPED_TOTALS_KEYS
        assert "avg_pace_s_per_km" in new["totals"]
        for effort_old, effort_new in zip(old["records"]["best_efforts"],
                                          new["records"]["best_efforts"]):
            assert set(effort_old) - set(effort_new) == DROPPED_BEST_EFFORT_KEYS
            assert perf.hms(effort_new["seconds"]) == effort_old["time"]
        for extreme_old, extreme_new in zip(old["records"]["extremes"],
                                            new["records"]["extremes"]):
            assert set(extreme_old) - set(extreme_new) == DROPPED_EXTREME_KEYS
            assert extreme_new["raw"] == extreme_old["raw"]
        for bucket_old, bucket_new in zip(old["distributions"]["pace"],
                                          new["distributions"]["pace"]):
            assert set(bucket_old) - set(bucket_new) == DROPPED_BUCKET_KEYS
            assert perf.pace_str(bucket_new["lo"]) == bucket_old["label"]

    def test_aggregate_keeps_the_metrics_year_over_year_keys_its_changes_on(self, client):
        """`changes` is keyed by name, so every one of those names must survive."""
        yoy = client.get("/api/aggregate").json()["year_over_year"]
        for row in yoy["years"]:
            assert set(yoy["metric_names"]) <= set(row)
            assert set(row["changes"]) <= set(yoy["metric_names"])

    @pytest.mark.parametrize("period", ["year", "month", "week"])
    def test_aggregate_periods(self, client, st, period):
        old = _as_json({"period": period, "rows": agg_mod.by_period(st, period)})
        new = client.get(f"/api/aggregate/periods?period={period}").json()
        assert new["period"] == period
        _strict_equal([_drop(r, DROPPED_TOTALS_KEYS) for r in new["rows"]],
                      [_drop(r, DROPPED_TOTALS_KEYS) for r in old["rows"]])

    def test_aggregate_filters(self, client, st):
        _strict_equal(client.get("/api/aggregate/filters").json(),
                      _as_json(agg_mod.available_filters(st)))

    def test_reports(self, client, st):
        _strict_equal(client.get("/api/reports").json(),
                      _as_json(reports_mod.compute_reports(st)))

    def test_race(self, client, st):
        old = _as_json(_old_race(st))
        new = client.get("/api/race").json()
        assert set(old) == set(new)
        _check_projection(new["projection"], old["projection"])
        assert [set(o) - set(n) for o, n in zip(old["recent_bests"], new["recent_bests"])] \
            == [DROPPED_PERSONAL_BEST_KEYS] * len(old["recent_bests"])
        old["recent_bests"] = [_drop(b, DROPPED_PERSONAL_BEST_KEYS)
                               for b in old["recent_bests"]]
        _strict_equal(_drop(new, {"projection"}), _drop(old, {"projection"}))

    def test_summary(self, client, st):
        old = _as_json(_old_summary(st))
        new = client.get("/api/summary").json()
        assert set(new) - set(old) == ADDED_SUMMARY_KEYS
        new = _drop(new, ADDED_SUMMARY_KEYS)
        assert set(old) == set(new)
        old_race, new_race = old.pop("race"), new.pop("race")
        _strict_equal(new, old)
        # Neither store has a calendar, so neither names a race (T57). The block is
        # null on both sides rather than describing a constant that outlived its race.
        assert old_race is None and new_race is None

    def test_summary_and_race_share_the_projection(self, client):
        summary_race = client.get("/api/summary").json()["race"]
        panel = client.get("/api/race").json()
        if summary_race is None:          # no race in the calendar (T57)
            assert panel["race"] is None and panel["projection"] is None
        else:
            assert summary_race["projection"] == panel["projection"]

    def test_health(self, client, st, db):
        new = client.get("/api/health").json()
        server_time = new.pop("server_time")
        _strict_equal(new, _as_json(_old_health(st, db)))
        assert datetime.fromisoformat(server_time).isoformat(timespec="seconds") \
            == server_time

    def test_garmin_status_disconnected(self, client, db):
        body = client.get("/api/garmin/status").json()
        _strict_equal(body, _as_json(auth_mod.garmin_status(db)))
        assert body["connected"] is False and body["tokens_updated_at"] is None

    def test_garmin_status_connected(self, client, db):
        token_dir = db.token_dir
        token_dir.mkdir(parents=True, exist_ok=True)
        connect_mod.token_file(token_dir).write_text("{}")
        body = client.get("/api/garmin/status").json()
        _strict_equal(body, _as_json(auth_mod.garmin_status(db)))
        assert body["connected"] is True and body["tokens_updated_at"].endswith("Z")

    def test_sync_status_before_any_run(self, client, st):
        old = _as_json(_old_sync_status(st))
        new = client.get("/api/sync/status").json()
        assert set(old) - set(new) == DROPPED_SYNC_STATUS_KEYS
        _strict_equal(new, _drop(old, DROPPED_SYNC_STATUS_KEYS))
        assert new["cursor"] == {} and new["state"] == "idle"

    @pytest.mark.parametrize("row", [
        # Mid activity list.
        {"state": "running", "phase": "activities", "done": 400, "total": 400,
         "eta_s": 0.0, "message": "oldest so far 2021-03-04",
         "started_at": "2026-09-20T05:00:00Z",
         "cursor": json.dumps({"activity_offset": 400, "oldest_day": "2021-03-04"})},
        # Mid details, with an ETA.
        {"state": "running", "phase": "details", "done": 25, "total": 100,
         "eta_s": 90.0, "message": "3 with GPS, 0 failed",
         "cursor": json.dumps({"last_activity": "123", "phase": "details"})},
        # The activity walk finished and cleared its offset.
        {"state": "done", "phase": "derive", "done": 2, "total": 2, "eta_s": 0.0,
         "finished_at": "2026-09-20T06:00:00Z", "message": "backfill complete",
         "cursor": json.dumps({"oldest_day": None})},
        # Failed before any phase began: Progress.finish writes phase "".
        {"state": "error", "phase": "", "done": 0, "total": 0, "eta_s": 0.0,
         "message": "NotAuthenticated: no token cache", "cursor": "not json"},
        {"state": "cancelled", "phase": "starting", "done": 0, "total": 0,
         "eta_s": None, "message": "stopped"},
    ])
    def test_sync_status_during_and_after_runs(self, client, st, row):
        st.set_sync_status("backfill", **row)
        old = _as_json(_old_sync_status(st))
        new = client.get("/api/sync/status").json()
        assert set(old) - set(new) == DROPPED_SYNC_STATUS_KEYS
        _strict_equal(new, _drop(old, DROPPED_SYNC_STATUS_KEYS))

    def test_sync_stop_when_idle(self, client):
        _strict_equal(client.post("/api/sync/stop").json(), {"stopping": False})


class TestTrendFlags:
    def test_flags_serialise_unchanged(self, rw_settings):
        """The seed has no deviations; make one (a resting-HR spike, a worse-than-
        baseline flag) and one the other way (an HRV jump) so `TrendFlag` is used."""
        with Store.open(rw_settings) as st:
            day = st.scalar("SELECT MAX(day) FROM daily_wellness")
            st.conn.execute("UPDATE daily_wellness SET resting_hr = 95 WHERE day = ?", (day,))
            st.conn.execute("UPDATE hrv_daily SET last_night_avg = 250 WHERE day = ?", (day,))
            st.conn.commit()
            old_summary = _as_json(_old_summary(st))
            old_ready = _as_json(ready_mod.compute_readiness(st))
        c = TestClient(create_app(rw_settings))
        verdicts = {f["metric"]: f["verdict"] for f in old_ready["flags"]}
        assert verdicts["resting_hr"] == "worse than baseline"
        assert verdicts["hrv"] == "better than baseline"
        _strict_equal(c.get("/api/readiness").json(), old_ready)
        new_summary = c.get("/api/summary").json()
        _strict_equal(new_summary["flags"], old_summary["flags"])
        _strict_equal(new_summary["readiness"], old_summary["readiness"])


class TestEmptyShapes:
    """Nulls and empties the models must allow (the equality tests above prove the
    keys match; these pin what a fresh install actually looks like)."""

    @pytest.fixture
    def empty(self, empty_settings):
        return TestClient(create_app(empty_settings))

    def test_load_is_empty_and_leaves_the_warmup_keys_out(self, empty):
        assert empty.get("/api/load").json() == {
            "curve": [], "weeks": [], "current": None, "ramp_pct": None}

    def test_readiness_components_are_an_empty_object(self, empty):
        body = empty.get("/api/readiness").json()
        assert body["components"] == {} and body["score"] is None
        assert body["band"] is None and body["day"] is None
        assert body["recommendation"] == "Not enough data to judge."

    def test_history_is_empty(self, empty):
        assert empty.get("/api/readiness/history").json() == {"days": 90, "series": []}

    def test_trends_leave_the_baseline_constants_out(self, empty):
        assert empty.get("/api/trends").json() == {"metrics": {}, "flags": []}

    def test_daily_is_empty(self, empty):
        assert empty.get("/api/daily").json() == {"days": 0, "rows": []}

    def test_aggregate_leaves_the_span_keys_out(self, empty):
        """With no activities there is no span to report, so `totals` stops at the
        zeroes and `streaks` says nothing about a window it does not have."""
        body = empty.get("/api/aggregate").json()
        assert body["totals"]["activities"] == 0
        assert not {"span_days", "span_years", "activities_per_week",
                    "distance_km_per_week"} & set(body["totals"])
        assert body["by_type"] == [] and body["by_year"] == [] and body["by_month"] == []
        assert body["year_over_year"]["years"] == []
        assert body["records"] == {"best_efforts": [], "extremes": []}
        assert body["streaks"]["longest"] == 0 and body["streaks"]["biggest_week"] is None
        assert "span_days" not in body["streaks"]
        assert body["filters"] == {}

    def test_aggregate_filters_are_empty(self, empty):
        assert empty.get("/api/aggregate/filters").json() == {
            "types": [], "gear": [], "range": {"first_day": None, "last_day": None}}

    def test_reports_are_empty(self, empty):
        body = empty.get("/api/reports").json()
        assert body["weekly"] == [] and body["monthly"] == []
        assert body["totals"]["activities"] == 0

    def test_race_has_no_projection(self, empty):
        body = empty.get("/api/race").json()
        assert body["projection"] is None and body["recent_bests"] == []
        assert body["weekly_km"] == [] and body["tsb_now"] is None

    def test_summary_nulls(self, empty):
        body = empty.get("/api/summary").json()
        assert body["latest_day"] is None and body["load"] is None
        assert body["ramp_flag"] is None and body["warmup_note"] is None
        # Null, not a block with a null projection: no calendar, so no race (T57).
        assert body["race"] is None and body["recent_weeks"] == []
        assert body["day_range"] == {"from": None, "to": None}
        assert body["readiness"]["components"] == {}


class TestRaceProjectionFallback:
    def test_from_seconds_when_there_are_no_recent_bests(self, rw_settings):
        """No best in the last 120 days: the projection comes from the all-time
        bests, and `from_seconds` has to be found there too."""
        from conftest import add_calendar_race

        with Store.open(rw_settings) as st:
            st.conn.execute(
                "INSERT INTO activities (activity_id, day, start_time_local, activity_type)"
                " VALUES ('future-walk', '2027-12-01', '2027-12-01 07:00:00', 'walking')")
            st.conn.commit()
            # A projection needs a race to project to, and the race is the calendar's
            # now (T57). Dated past the planted walk so it is still ahead.
            add_calendar_race(st, day="2028-01-15")
            old = _as_json(_old_race(st))
        assert old["recent_bests"] == [] and old["projection"] is not None
        new = TestClient(create_app(rw_settings)).get("/api/race").json()
        _check_projection(new["projection"], old["projection"])


# ---------------------------------------------------------------------------
# Literals and field lists match what the code produces
# ---------------------------------------------------------------------------


class TestClosedSets:
    def test_trend_metrics(self):
        assert list(get_args(schemas.TrendMetric)) == trends_mod.TREND_METRICS

    def test_sync_phases(self):
        assert get_args(schemas.SyncPhase) == backfill_mod.PHASES

    def test_readiness_bands(self):
        produced = {ready_mod.readiness_band(s / 2) for s in range(0, 201)}
        assert produced == set(get_args(schemas.ReadinessBand))

    def test_form_labels(self):
        produced = {load_mod.form_label(t / 4) for t in range(-200, 201)}
        assert produced == set(get_args(schemas.FormLabel))

    def test_readiness_component_and_weight_keys(self):
        assert set(schemas.ReadinessComponents.model_fields) == set(ready_mod.WEIGHTS)
        assert set(schemas.ReadinessWeights.model_fields) == set(ready_mod.WEIGHTS)

    def test_daily_row_declares_every_view_column(self, empty_settings):
        with Store.open(empty_settings) as st:
            cols = [d[0] for d in st.conn.execute("SELECT * FROM v_daily LIMIT 0").description]
        assert list(schemas.DailyRow.model_fields) == cols, (
            "v_daily changed shape: declare the new column on DailyRow")

    def test_extreme_keys(self, rw_settings):
        """The UI switches on `key` to know what unit `raw` is in, so every key
        `records` can produce has to be in the Literal — and be reachable."""
        with Store.open(rw_settings) as st:
            produced = {e["key"] for e in agg_mod.records(st)["extremes"]}
        assert produced == set(get_args(schemas.ExtremeKey))

    def test_daily_sleep_row_adds_only_light_sleep(self):
        assert (set(schemas.DailySleepRow.model_fields)
                - set(schemas.DailyRow.model_fields)) == ADDED_DAILY_KEYS

    def test_trend_verdicts(self):
        """Every verdict `series_trend` can reach, from a baseline with no spread
        (insufficient data) to one 3 sigma either side of it."""
        days = [f"2026-01-{d:02d}" for d in range(1, 12)]
        flat = [50.0] * 10
        produced = {
            trends_mod.series_trend(days, [*flat, latest], "resting_hr")["verdict"]
            for latest in (None, 50.0, 40.0, 60.0)
        }
        produced |= {
            trends_mod.series_trend(days, [*flat[:9], 52.0, latest], "resting_hr")["verdict"]
            for latest in (50.0, 40.0, 60.0)
        }
        assert produced == set(get_args(schemas.TrendVerdict))

    def test_integer_distances_stay_integers(self, rw_settings):
        """Standard distances mix ints and floats; `Number` keeps each as it was."""
        body = TestClient(create_app(rw_settings)).get("/api/race").json()
        types = {type(b["distance_m"]) for b in body["recent_bests"]}
        assert int in types
        by_d = {b["distance_m"]: b for b in body["recent_bests"]}
        if 1609.34 in by_d:
            assert isinstance(by_d[1609.34]["distance_m"], float)


# ---------------------------------------------------------------------------
# sync/start body
# ---------------------------------------------------------------------------


class TestSyncStartBody:
    @pytest.fixture
    def app(self, empty_settings):
        return create_app(empty_settings)

    @pytest.mark.parametrize("body", [
        {"phases": ["nope"]},
        {"phases": "details"},            # a string, not a list
        {"phases": [1]},
        {"detail_limit": "lots"},
        {"detail_limit": -1},
        {"detail_limit": 2.5},
        {"detail_limt": 5},               # a typo is not a full backfill
        [],
    ])
    def test_bad_body_is_422(self, app, body):
        res = TestClient(app).post("/api/sync/start", json=body)
        assert res.status_code == 422, res.text

    @pytest.mark.parametrize("body", [None, {}, {"phases": ["details"], "detail_limit": 3}])
    def test_good_body_reaches_the_handler(self, app, body):
        """Not connected to Garmin, so the handler answers 409, not validation."""
        c = TestClient(app)
        res = c.post("/api/sync/start") if body is None else c.post("/api/sync/start",
                                                                        json=body)
        assert res.status_code == 409
        assert "no Garmin account connected" in res.json()["detail"]

    @pytest.mark.parametrize("body, phases, limit", [
        (None, list(backfill_mod.PHASES), None),
        ({}, list(backfill_mod.PHASES), None),
        ({"phases": []}, list(backfill_mod.PHASES), None),
        ({"phases": None, "detail_limit": None}, list(backfill_mod.PHASES), None),
        ({"phases": ["details", "derive"], "detail_limit": 5}, ["details", "derive"], 5),
        ({"detail_limit": 0}, list(backfill_mod.PHASES), None),
        ({"detail_limit": "7"}, list(backfill_mod.PHASES), 7),
    ])
    def test_body_reaches_the_backfill_as_before(self, app, empty_settings, monkeypatch,
                                                 body, phases, limit):
        calls: list[dict[str, Any]] = []
        monkeypatch.setattr(backfill_mod, "run",
                            lambda st, settings, **kw: calls.append(kw))
        tok = empty_settings.token_dir
        tok.mkdir(parents=True, exist_ok=True)
        connect_mod.token_file(tok).write_text("{}")

        c = TestClient(app)
        res = c.post("/api/sync/start") if body is None else c.post("/api/sync/start",
                                                                        json=body)
        assert res.status_code == 200, res.text
        _strict_equal(res.json(), {"status": "started", "phases": phases})
        app.state.job.thread.join(5)
        assert app.state.job.last_error is None
        assert len(calls) == 1
        assert calls[0]["phases"] == phases and calls[0]["detail_limit"] == limit


# ---------------------------------------------------------------------------
# OpenAPI
# ---------------------------------------------------------------------------


class TestOpenApi:
    @pytest.fixture
    def spec(self, empty_settings):
        return TestClient(create_app(empty_settings)).get("/openapi.json").json()

    @staticmethod
    def _ref(schema: dict[str, Any]) -> str:
        return schema["$ref"].rsplit("/", 1)[-1]

    @pytest.mark.parametrize("path, method, model", [
        ("/api/summary", "get", "Summary"),
        ("/api/load", "get", "TrainingLoad"),
        ("/api/readiness", "get", "Readiness"),
        ("/api/readiness/history", "get", "ReadinessHistory"),
        ("/api/trends", "get", "Trends"),
        ("/api/daily", "get", "DailyList"),
        ("/api/aggregate", "get", "Aggregate"),
        ("/api/aggregate/filters", "get", "AggregateFilters"),
        ("/api/aggregate/periods", "get", "AggregatePeriods"),
        ("/api/reports", "get", "Reports"),
        ("/api/race", "get", "RacePanel"),
        ("/api/health", "get", "Health"),
        ("/api/garmin/status", "get", "GarminStatus"),
        ("/api/sync/status", "get", "SyncStatus"),
        ("/api/sync/start", "post", "SyncStarted"),
        ("/api/sync/stop", "post", "SyncStopResult"),
    ])
    def test_paths_reference_named_models(self, spec, path, method, model):
        schema = spec["paths"][path][method]["responses"]["200"]["content"][
            "application/json"]["schema"]
        assert self._ref(schema) == model
        assert model in spec["components"]["schemas"]

    def test_sync_start_body_is_a_named_optional_model(self, spec):
        body = spec["paths"]["/api/sync/start"]["post"]["requestBody"]
        assert self._ref(body["content"]["application/json"]["schema"]) == "SyncStartRequest"
        assert not body.get("required", False)
        props = spec["components"]["schemas"]["SyncStartRequest"]
        assert set(props["properties"]) == {"phases", "detail_limit"}
        assert props.get("additionalProperties") is False

    def test_repeated_shapes_are_one_model(self, spec):
        comps = spec["components"]["schemas"]

        def refs(model: str, field: str) -> set[str]:
            s = comps[model]["properties"][field]
            opts = s.get("anyOf", [s])
            return {self._ref(o) for o in opts if "$ref" in o}

        assert refs("Summary", "readiness") == {"Readiness"}
        assert refs("Summary", "load") == refs("TrainingLoad", "current") == {"LoadCurrent"}
        assert refs("Summary", "race") == {"SummaryRace"}
        assert refs("SummaryRace", "projection") == refs("RacePanel", "projection") \
            == {"RaceProjection"}
        assert refs("Summary", "day_range") == refs("Health", "day_range") == {"DayRange"}
        flag_items = [comps[m]["properties"]["flags"]["items"] for m in ("Summary", "Readiness")]
        assert {self._ref(i) for i in flag_items} == {"TrendFlag"}

    def test_dropped_strings_are_not_in_the_schema(self, spec):
        comps = spec["components"]["schemas"]
        assert not DROPPED_PROJECTION_KEYS & set(comps["RaceProjection"]["properties"])
        assert "from_seconds" in comps["RaceProjection"]["properties"]
        assert not DROPPED_PERSONAL_BEST_KEYS & set(comps["PersonalBest"]["properties"])
        assert not DROPPED_SYNC_STATUS_KEYS & set(comps["SyncStatus"]["properties"])
        assert "eta_s" in comps["SyncStatus"]["properties"]

    def test_prose_fields_are_kept(self, spec):
        comps = spec["components"]["schemas"]
        assert {"reasons", "recommendation"} <= set(comps["Readiness"]["properties"])
        assert set(comps["RaceNote"]["properties"]) == {"level", "text"}
        assert "warmup_note" in comps["TrainingLoad"]["properties"]
        assert "message" in comps["SyncStatus"]["properties"]

    def test_day_range_is_spelled_from(self, spec):
        assert set(spec["components"]["schemas"]["DayRange"]["properties"]) == {"from", "to"}

    def test_keys_absent_on_an_empty_db_are_not_required(self, spec):
        comps = spec["components"]["schemas"]
        required = set(comps["TrainingLoad"]["required"])
        assert required == {"curve", "weeks", "current", "ramp_pct"}
        assert "required" not in comps["ReadinessComponents"]
        assert "required" not in comps["SyncCursor"]
