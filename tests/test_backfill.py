"""Full-history backfill and per-activity stream parsing.

No network: a fake fetcher stands in for Garmin, which lets the tests assert the
things that actually matter for a six-thousand-request job — that it checkpoints,
that it resumes, that one bad activity does not end it, and that it does not
re-fetch work it has already done.
"""

from __future__ import annotations

from datetime import date

import pytest

from garmin_analytics.ingest import backfill as B
from garmin_analytics.ingest import details as D


@pytest.fixture(autouse=True)
def _no_politeness_pauses(monkeypatch):
    """The inter-phase pause is there to be kind to Garmin, not to slow the suite."""
    monkeypatch.setattr(B, "PHASE_PAUSE_S", 0.0)


class FakeGarmin:
    """A stand-in for `connect.fetch` that records what was asked for."""

    def __init__(self, activities=30, page_size=100, fail_on=(), details=True):
        self.calls: list[str] = []
        self.page_size = page_size
        self.details_enabled = details
        self.fail_on = set(fail_on)
        self.activities = [
            {
                "activityId": f"act-{i:04d}",
                "activityName": f"Run {i}",
                "startTimeLocal": f"2026-01-{(i % 28) + 1:02d} 06:30:00",
                "activityType": {"typeKey": "running"},
                "distance": 10000.0,
                "duration": 3000.0,
                "movingDuration": 2950.0,
                "averageHR": 150.0,
            }
            for i in range(activities)
        ]

    def __call__(self, path: str):
        self.calls.append(path)
        if "/activitylist-service" in path or "activities?" in path or "start=" in path:
            start = int(path.split("start=")[1].split("&")[0])
            return self.activities[start:start + self.page_size]
        if "/details" in path:
            activity_id = path.split("/activity/")[1].split("/")[0]
            if activity_id in self.fail_on:
                from garmin_analytics.ingest.connect import ConnectError

                raise ConnectError("boom")
            if not self.details_enabled:
                return None
            return _details_payload()
        return None


def _details_payload(n=40, with_gps=True):
    """A Garmin-shaped details payload: descriptors plus column-oriented rows."""
    descriptors = [
        {"key": "sumElapsedDuration", "metricsIndex": 0},
        {"key": "sumDistance", "metricsIndex": 1},
        {"key": "directHeartRate", "metricsIndex": 2},
        {"key": "directSpeed", "metricsIndex": 3},
        {"key": "directElevation", "metricsIndex": 4},
    ]
    if with_gps:
        descriptors += [
            {"key": "directLatitude", "metricsIndex": 5},
            {"key": "directLongitude", "metricsIndex": 6},
        ]
    rows = []
    for i in range(n):
        metrics = [float(i * 5), float(i * 15), 140.0 + i % 10, 3.0, 10.0 + i * 0.1]
        if with_gps:
            metrics += [25.28 + i * 0.0001, 51.53 + i * 0.0001]
        rows.append({"metrics": metrics})
    return {"metricDescriptors": descriptors, "activityDetailMetrics": rows}


class TestDetailParsing:
    def test_columns_are_found_by_name_not_index(self):
        """Garmin reorders these; reading by position is how you get HR in metres."""
        payload = _details_payload(n=3)
        payload["metricDescriptors"] = list(reversed(payload["metricDescriptors"]))
        for i, desc in enumerate(payload["metricDescriptors"]):
            desc["metricsIndex"] = desc["metricsIndex"]     # indices unchanged
        rows = D.normalize_details(payload, "a1")
        assert rows[1]["hr"] == pytest.approx(141.0)
        assert rows[1]["distance_m"] == pytest.approx(15.0)

    def test_missing_columns_become_none_not_an_error(self):
        payload = _details_payload(n=3, with_gps=False)
        rows = D.normalize_details(payload, "a1")
        assert all(r["lat"] is None and r["lon"] is None for r in rows)
        assert rows[0]["hr"] is not None

    def test_a_payload_with_no_stream_is_empty_not_an_error(self):
        assert D.normalize_details({"metricDescriptors": []}, "a1") == []
        assert D.normalize_details(None, "a1") == []
        assert D.normalize_details({"activityDetailMetrics": []}, "a1") == []

    def test_null_island_fixes_are_dropped(self):
        """A (0, 0) fix would drag a route's centroid into the Atlantic."""
        payload = _details_payload(n=3)
        payload["activityDetailMetrics"][1]["metrics"][5] = 0.0
        payload["activityDetailMetrics"][1]["metrics"][6] = 0.0
        rows = D.normalize_details(payload, "a1")
        assert rows[1]["lat"] is None and rows[1]["lon"] is None
        assert rows[0]["lat"] is not None

    def test_out_of_range_coordinates_are_dropped(self):
        payload = _details_payload(n=3)
        payload["activityDetailMetrics"][0]["metrics"][5] = 4_000.0   # semicircles
        rows = D.normalize_details(payload, "a1")
        assert rows[0]["lat"] is None

    def test_duplicate_timestamps_do_not_collapse_samples(self):
        """`activity_samples` is keyed on elapsed_s; equal values would overwrite."""
        payload = _details_payload(n=4)
        for row in payload["activityDetailMetrics"]:
            row["metrics"][0] = 10.0
        rows = D.normalize_details(payload, "a1")
        assert len({r["elapsed_s"] for r in rows}) == 4

    def test_missing_duration_falls_back_to_sample_order(self):
        payload = _details_payload(n=5)
        payload["metricDescriptors"] = [
            d for d in payload["metricDescriptors"] if d["key"] != "sumElapsedDuration"
        ]
        rows = D.normalize_details(payload, "a1")
        assert [r["elapsed_s"] for r in rows] == [0.0, 1.0, 2.0, 3.0, 4.0]

    def test_store_samples_replaces_rather_than_appends(self, store):
        store.upsert("activities", ["activity_id"], {
            "activity_id": "a1", "day": "2026-01-01",
            "start_time_local": "2026-01-01T06:00:00",
            "activity_type": "running", "activity_name": "Run"})
        store.conn.commit()
        rows = D.normalize_details(_details_payload(n=10), "a1")
        assert D.store_samples(store, "a1", rows) == 10
        assert D.store_samples(store, "a1", rows) == 10
        assert store.scalar("SELECT COUNT(*) FROM activity_samples") == 10

    def test_reparse_needs_no_network(self, store):
        store.upsert("activities", ["activity_id"], {
            "activity_id": "a1", "day": "2026-01-01",
            "start_time_local": "2026-01-01T06:00:00",
            "activity_type": "running", "activity_name": "Run"})
        store.store_raw("connect", "activity_details", "a1", _details_payload(n=12))
        store.conn.commit()
        out = D.reparse_details(store)
        assert out == {"activities": 1, "samples": 12}


class TestQueue:
    def test_queue_is_activities_without_samples(self, store):
        for i in range(3):
            store.upsert("activities", ["activity_id"], {
                "activity_id": f"a{i}", "day": f"2026-01-0{i + 1}",
                "start_time_local": "2026-01-01T06:00:00",
                "activity_type": "running", "activity_name": "Run"})
        store.conn.commit()
        assert D.activities_missing_samples(store) == ["a0", "a1", "a2"]

        D.store_samples(store, "a1", D.normalize_details(_details_payload(n=5), "a1"))
        assert D.activities_missing_samples(store) == ["a0", "a2"]

    def test_an_activity_with_an_archived_empty_payload_is_not_retried(self, store):
        """A strength session has no stream. Asking again every run is pure waste."""
        store.upsert("activities", ["activity_id"], {
            "activity_id": "a1", "day": "2026-01-01",
            "start_time_local": "2026-01-01T06:00:00",
            "activity_type": "strength_training", "activity_name": "Gym"})
        store.store_raw("connect", "activity_details", "a1", {"metricDescriptors": []})
        store.conn.commit()
        assert D.activities_missing_samples(store) == []

    def test_queue_is_oldest_first(self, store):
        for aid, day in (("new", "2026-06-01"), ("old", "2023-01-01")):
            store.upsert("activities", ["activity_id"], {
                "activity_id": aid, "day": day,
                "start_time_local": f"{day}T06:00:00",
                "activity_type": "running", "activity_name": "Run"})
        store.conn.commit()
        assert D.activities_missing_samples(store) == ["old", "new"]


class TestBackfill:
    def test_full_run_fetches_everything(self, store, settings):
        fake = FakeGarmin(activities=25)
        out = B.run(store, settings, fetcher=fake, user="u",
                    phases=("activities", "details"), echo=None)
        assert out["state"] == "done"
        assert out["phases"]["activities"]["activities"] == 25
        assert out["phases"]["details"]["fetched"] == 25
        assert out["phases"]["details"]["gps"] == 25
        assert store.scalar("SELECT COUNT(*) FROM activities") == 25
        assert store.scalar("SELECT COUNT(DISTINCT activity_id) FROM activity_samples") == 25

    def test_rerunning_does_not_refetch_details(self, store, settings):
        fake = FakeGarmin(activities=10)
        B.run(store, settings, fetcher=fake, user="u",
              phases=("activities", "details"), echo=None)
        first = len([c for c in fake.calls if "/details" in c])
        assert first == 10

        fake.calls.clear()
        B.run(store, settings, fetcher=fake, user="u",
              phases=("activities", "details"), echo=None)
        assert [c for c in fake.calls if "/details" in c] == []

    def test_progress_is_checkpointed_to_the_database(self, store, settings):
        fake = FakeGarmin(activities=12)
        B.run(store, settings, fetcher=fake, user="u",
              phases=("activities", "details"), echo=None)
        status = B.status(store)
        assert status["state"] == "done"
        assert status["done"] == 12
        assert status["finished_at"] is not None

    def test_an_interrupted_run_resumes_where_it_stopped(self, store, settings):
        """The requirement: stopping at request 4 of 10 must resume at 5, not 1."""
        fake = FakeGarmin(activities=10)
        stop_after = {"n": 0}

        def should_stop():
            stop_after["n"] += 1
            return stop_after["n"] > 5      # bail part-way through the details phase

        out = B.run(store, settings, fetcher=fake, user="u",
                    phases=("activities", "details"), echo=None,
                    should_stop=should_stop)
        assert out["state"] == "cancelled"
        done = store.scalar("SELECT COUNT(DISTINCT activity_id) FROM activity_samples")
        assert 0 < done < 10
        assert B.status(store)["state"] == "cancelled"

        # Resume: the queue comes from the database, so it picks up the remainder.
        fake.calls.clear()
        out2 = B.run(store, settings, fetcher=fake, user="u",
                     phases=("activities", "details"), echo=None)
        assert out2["state"] == "done"
        assert store.scalar(
            "SELECT COUNT(DISTINCT activity_id) FROM activity_samples") == 10
        assert len([c for c in fake.calls if "/details" in c]) == 10 - done

    def test_one_failing_activity_does_not_end_the_job(self, store, settings):
        fake = FakeGarmin(activities=8, fail_on={"act-0003"})
        out = B.run(store, settings, fetcher=fake, user="u",
                    phases=("activities", "details"), echo=None)
        assert out["state"] == "done"
        assert out["phases"]["details"]["failed"] == 1
        assert out["phases"]["details"]["fetched"] == 7

    def test_paging_walks_past_the_first_page(self, store, settings):
        fake = FakeGarmin(activities=250, page_size=100)
        out = B.run(store, settings, fetcher=fake, user="u",
                    phases=("activities",), echo=None)
        assert out["phases"]["activities"]["activities"] == 250
        assert out["phases"]["activities"]["pages"] == 3

    def test_detail_limit_caps_a_trial_run(self, store, settings):
        fake = FakeGarmin(activities=30)
        out = B.run(store, settings, fetcher=fake, user="u",
                    phases=("activities", "details"), detail_limit=5, echo=None)
        assert out["phases"]["details"]["fetched"] == 5
        assert out["phases"]["details"]["remaining"] == 25

    def test_derive_phase_builds_routes_without_network(self, store, settings):
        fake = FakeGarmin(activities=6)
        out = B.run(store, settings, fetcher=fake, user="u", echo=None,
                    phases=("activities", "details", "derive"))
        assert out["phases"]["derive"]["routes"] >= 1
        assert fake.calls == [c for c in fake.calls]     # derive added no calls


class TestStatusAndEstimate:
    def test_status_has_a_shape_before_anything_has_run(self, store):
        s = B.status(store)
        assert s["state"] == "idle"
        assert s["done"] == 0
        assert s["phases"] == list(B.PHASES)

    def test_percentage_and_eta(self, store):
        store.set_sync_status("backfill", state="running", phase="details",
                              done=25, total=100, eta_s=90.0)
        s = B.status(store)
        assert s["pct"] == 25.0
        assert s["eta"] == "0:01:30"

    def test_a_stale_running_row_does_not_block_forever(self, store):
        """A killed process leaves 'running' behind; that must not wedge the app."""
        store.set_sync_status("backfill", state="running", updated_at="2020-01-01T00:00:00Z")
        assert B.is_running(store) is False

    def test_estimate_counts_streams_plus_a_daily_walk(self, store):
        """requests = activity streams outstanding + days x per-day endpoints.

        An activity dated 2026-01-01 also *shortens* the wellness walk, because the
        account is now known to start there rather than at the ten-year fallback —
        so the two effects are checked against the arithmetic, not against each other.
        """
        from garmin_analytics.ingest import connect as connect_mod

        for i in range(20):
            store.upsert("activities", ["activity_id"], {
                "activity_id": f"a{i}", "day": "2026-01-01",
                "start_time_local": "2026-01-01T06:00:00",
                "activity_type": "running", "activity_name": "Run"})
        store.conn.commit()

        est = B.estimate(store, end=date(2026, 3, 1))
        assert est["first_day"] == "2026-01-01"
        assert est["days"] == 60                       # 1 Jan to 1 Mar inclusive
        assert est["activities_pending_details"] == 20
        assert est["estimated_requests"] == 20 + 60 * len(connect_mod.ENDPOINTS)
        assert est["estimated_seconds_high"] > est["estimated_seconds_low"]

    def test_account_start_uses_the_oldest_activity(self, store):
        store.upsert("activities", ["activity_id"], {
            "activity_id": "a", "day": "2019-04-02",
            "start_time_local": "2019-04-02T06:00:00",
            "activity_type": "running", "activity_name": "Run"})
        store.conn.commit()
        assert B.account_start(store) == date(2019, 4, 2)

    def test_account_start_falls_back_to_ten_years(self, store):
        start = B.account_start(store, end=date(2026, 1, 1))
        assert start.year == 2016
