"""Every API endpoint, through FastAPI's TestClient.

The curl transcript in VERIFICATION.md exercises the same routes against a live
uvicorn; this file is the version that runs in CI and asserts on shapes.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from garmin_analytics.api.server import create_app


@pytest.fixture
def client(seeded_db):
    return TestClient(create_app(seeded_db))


@pytest.fixture
def empty_client(settings):
    from garmin_analytics.db.store import Store

    Store.open(settings).close()      # create the schema, leave it empty
    return TestClient(create_app(settings))


class TestHealthAndMeta:
    def test_health(self, client):
        body = client.get("/api/health").json()
        assert body["status"] == "ok"
        assert body["synthetic"] is True
        assert body["day_range"]["from"] < body["day_range"]["to"]

    def test_config_exposes_no_secrets(self, client):
        body = client.get("/api/config").json()
        assert body["race"]["date"] == "2027-01-15"
        assert body["race"]["start_local"] == "07:35"
        flat = str(body).lower()
        for forbidden in ("password", "token", "oauth", "cookie", "secret"):
            assert forbidden not in flat

    def test_doctor(self, client):
        body = client.get("/api/doctor").json()
        assert body["overall"] in {"ok", "warn", "fail"}
        assert any(c["check"] == "data provenance" for c in body["checks"])

    def test_doctor_flags_synthetic_data(self, client):
        checks = {c["check"]: c for c in client.get("/api/doctor").json()["checks"]}
        assert checks["data provenance"]["synthetic"] is True
        assert "SYNTHETIC" in checks["data provenance"]["detail"]

    def test_doctor_never_prints_a_token(self, client):
        assert "eyJ" not in client.get("/api/doctor").text   # a JWT prefix


class TestSummary:
    def test_shape(self, client):
        body = client.get("/api/summary").json()
        for key in ("day_range", "readiness", "load", "flags", "totals", "streaks",
                    "race", "recent_weeks"):
            assert key in body

    def test_values_are_populated(self, client):
        body = client.get("/api/summary").json()
        assert body["readiness"]["score"] is not None
        assert body["load"]["ctl"] > 0
        assert body["totals"]["activities"] > 0
        assert body["race"]["days_to_go"] is not None

    def test_recent_weeks_are_capped_at_eight(self, client):
        assert len(client.get("/api/summary").json()["recent_weeks"]) <= 8


class TestLoad:
    def test_curve_and_current(self, client):
        body = client.get("/api/load").json()
        assert body["curve"]
        assert body["current"]["tsb"] == pytest.approx(
            body["current"]["ctl"] - body["current"]["atl"], abs=0.02)

    def test_curve_is_dense_and_ordered(self, client):
        from datetime import date, timedelta

        curve = client.get("/api/load").json()["curve"]
        days = [date.fromisoformat(r["day"]) for r in curve]
        assert days == sorted(days)
        assert days[-1] - days[0] == timedelta(days=len(days) - 1)

    def test_date_window(self, client):
        body = client.get("/api/load?start=2026-08-01&end=2026-08-31").json()
        assert len(body["curve"]) == 31
        assert body["curve"][0]["day"] == "2026-08-01"

    def test_weeks_carry_the_ramp_flag(self, client):
        for week in client.get("/api/load").json()["weeks"]:
            assert isinstance(week["overreaching"], bool)


class TestTrends:
    def test_default_metrics(self, client):
        body = client.get("/api/trends?days=90").json()
        assert set(body["metrics"]) == {"resting_hr", "hrv", "sleep_score",
                                        "total_sleep_s", "bb_high", "stress_avg"}

    def test_metric_subset(self, client):
        body = client.get("/api/trends?days=90&metrics=hrv,resting_hr").json()
        assert set(body["metrics"]) == {"hrv", "resting_hr"}

    def test_unknown_metric_is_a_400_with_a_useful_message(self, client):
        res = client.get("/api/trends?metrics=bogus")
        assert res.status_code == 400
        assert "bogus" in res.json()["detail"]

    def test_days_is_validated(self, client):
        assert client.get("/api/trends?days=0").status_code == 422
        assert client.get("/api/trends?days=99999").status_code == 422

    def test_series_lengths_are_aligned(self, client):
        body = client.get("/api/trends?days=90").json()
        for t in body["metrics"].values():
            n = len(t["days"])
            assert len(t["values"]) == n == len(t["roll7"]) == len(t["roll28"])


class TestReadiness:
    def test_today(self, client):
        body = client.get("/api/readiness").json()
        assert 0 <= body["score"] <= 100
        assert len(body["reasons"]) == 4
        assert body["recommendation"]

    def test_specific_day(self, client):
        latest = client.get("/api/health").json()["day_range"]["to"]
        body = client.get(f"/api/readiness?day={latest}").json()
        assert body["day"] == latest

    def test_history(self, client):
        body = client.get("/api/readiness/history?days=30").json()
        assert body["days"] == 30
        assert 0 < len(body["series"]) <= 30

    def test_history_bounds_are_validated(self, client):
        assert client.get("/api/readiness/history?days=3").status_code == 422


class TestPerformance:
    def test_shape(self, client):
        body = client.get("/api/performance").json()
        assert body["personal_bests"]
        assert body["vo2max"]
        for pb in body["personal_bests"]:
            assert pb["time"] and pb["pace"] and pb["day"]

    def test_bests_are_ordered_by_distance(self, client):
        dists = [p["distance_m"] for p in client.get("/api/performance").json()["personal_bests"]]
        assert dists == sorted(dists)


class TestRace:
    def test_shape(self, client):
        body = client.get("/api/race").json()
        assert body["race"]["name"].startswith("Doha Marathon")
        assert body["race"]["date"] == "2027-01-15"
        assert isinstance(body["notes"], list)

    def test_notes_carry_severity(self, client):
        for note in client.get("/api/race").json()["notes"]:
            assert note["level"] in {"good", "warning"}

    def test_projection_is_self_describing(self, client):
        p = client.get("/api/race").json()["projection"]
        assert p["projected_time"] and p["from_label"] and p["from_day"]


class TestReports:
    def test_shape(self, client):
        body = client.get("/api/reports").json()
        assert body["weekly"] and body["monthly"]
        assert body["streaks"]["longest_active"]["length"] > 0
        assert len(body["weekday_consistency"]) == 7

    def test_run_km_never_exceeds_total_km(self, client):
        for week in client.get("/api/reports").json()["weekly"]:
            assert week["run_km"] <= week["km"] + 1e-9


class TestDaily:
    def test_rows_and_cap(self, client):
        body = client.get("/api/daily?days=30").json()
        assert body["days"] == len(body["rows"]) <= 30
        assert "resting_hr" in body["rows"][0]

    def test_rows_are_chronological(self, client):
        rows = client.get("/api/daily?days=60").json()["rows"]
        assert [r["day"] for r in rows] == sorted(r["day"] for r in rows)


class TestActivities:
    def test_listing(self, client):
        body = client.get("/api/activities?limit=10").json()
        assert body["total"] > 10
        assert len(body["rows"]) == 10
        assert "running" in body["types"]

    def test_default_sort_is_newest_first(self, client):
        days = [r["day"] for r in client.get("/api/activities?limit=20").json()["rows"]]
        assert days == sorted(days, reverse=True)

    def test_sort_ascending(self, client):
        rows = client.get("/api/activities?limit=20&sort=distance_m&order=asc").json()["rows"]
        dists = [r["distance_m"] or 0 for r in rows]
        assert dists == sorted(dists)

    def test_bad_sort_column_is_rejected(self, client):
        """Sort keys reach SQL, so they are allow-listed, not interpolated."""
        res = client.get("/api/activities?sort=day;DROP TABLE activities")
        assert res.status_code == 400
        assert client.get("/api/health").status_code == 200   # still alive

    def test_bad_order_is_rejected_by_the_pattern(self, client):
        assert client.get("/api/activities?order=sideways").status_code == 422

    def test_type_filter(self, client):
        rows = client.get("/api/activities?type=cycling&limit=50").json()["rows"]
        assert rows and all(r["activity_type"] == "cycling" for r in rows)

    def test_date_filter(self, client):
        body = client.get("/api/activities?start=2026-09-01&end=2026-09-10&limit=100").json()
        assert body["rows"]
        assert all("2026-09-01" <= r["day"] <= "2026-09-10" for r in body["rows"])

    def test_name_search(self, client):
        rows = client.get("/api/activities?q=Long&limit=20").json()["rows"]
        assert rows and all("Long" in (r["activity_name"] or "") for r in rows)

    def test_search_is_parameterised(self, client):
        res = client.get("/api/activities?q=%' OR '1'='1")
        assert res.status_code == 200
        assert res.json()["total"] == 0

    def test_paging(self, client):
        first = client.get("/api/activities?limit=5&offset=0").json()
        second = client.get("/api/activities?limit=5&offset=5").json()
        assert first["total"] == second["total"]
        assert {r["activity_id"] for r in first["rows"]} & {
            r["activity_id"] for r in second["rows"]} == set()

    def test_limit_is_capped(self, client):
        assert client.get("/api/activities?limit=100000").status_code == 422


class TestActivityDetail:
    @pytest.fixture
    def run_id(self, client):
        return client.get("/api/activities?type=running&limit=1").json()["rows"][0]["activity_id"]

    def test_detail_shape(self, client, run_id):
        body = client.get(f"/api/activities/{run_id}").json()
        assert body["activity"]["activity_id"] == run_id
        assert body["hr_zones"]
        assert body["samples"]

    def test_splits_are_sequential(self, client, run_id):
        splits = client.get(f"/api/activities/{run_id}").json()["km_splits"]
        assert [s["km"] for s in splits] == list(range(1, len(splits) + 1))
        for s in splits:
            assert s["seconds"] > 0 and s["pace"]

    def test_best_efforts_are_labelled(self, client, run_id):
        for b in client.get(f"/api/activities/{run_id}").json()["best_efforts"]:
            assert b["label"] and b["time"] and b["pace"]

    def test_samples_can_be_suppressed(self, client, run_id):
        body = client.get(f"/api/activities/{run_id}?samples=false").json()
        assert body["samples"] == []

    def test_unknown_activity_is_404(self, client):
        res = client.get("/api/activities/does-not-exist")
        assert res.status_code == 404
        assert "does-not-exist" in res.json()["detail"]


class TestRawArchive:
    def test_returns_the_verbatim_payload(self, client):
        aid = client.get("/api/activities?limit=1").json()["rows"][0]["activity_id"]
        body = client.get(f"/api/raw/activities/{aid}").json()
        assert body["source"] == "seed"
        assert body["payload"]["activityId"] == aid
        # A field the normalised table does not model must still be here.
        assert "_synthetic" in body["payload"]

    def test_unknown_reference_is_404(self, client):
        assert client.get("/api/raw/activities/nope").status_code == 404


class TestStaticAssets:
    def test_index_is_served(self, client):
        res = client.get("/")
        assert res.status_code == 200
        assert "Garmin Analytics" in res.text

    @pytest.mark.parametrize("path", [
        "/static/app.js", "/static/style.css",
        "/static/vendor/uPlot.iife.min.js", "/static/vendor/uPlot.min.css",
    ])
    def test_assets_are_served_locally(self, client, path):
        res = client.get(path)
        assert res.status_code == 200 and len(res.content) > 100


class TestEmptyDatabase:
    """A fresh install must render, not explode."""

    def test_health(self, empty_client):
        body = empty_client.get("/api/health").json()
        assert body["status"] == "ok"
        assert body["day_range"] == {"from": None, "to": None}
        assert body["synthetic"] is False

    @pytest.mark.parametrize("path", [
        "/api/summary", "/api/load", "/api/trends", "/api/readiness",
        "/api/readiness/history", "/api/performance", "/api/race", "/api/reports",
        "/api/daily", "/api/activities", "/api/doctor", "/api/config", "/",
    ])
    def test_every_endpoint_survives(self, empty_client, path):
        assert empty_client.get(path).status_code == 200
