"""The watch's laps: a structured workout's intervals as Garmin timed them."""

from __future__ import annotations

from fastapi.testclient import TestClient

from garmin_analytics.api.server import create_app
from garmin_analytics.ingest import auto_sync as A
from garmin_analytics.ingest import connect as connect_mod
from garmin_analytics.ingest import details as details_mod
from garmin_analytics.ingest import laps as L

AID = "run-1"


def _lap(index, start, duration, intensity, step, hr=None, max_hr=None, speed=None,
         cadence=None, distance=None):
    """A lapDTO with the fields the parser reads, shaped like Garmin's."""
    return {
        "lapIndex": index,
        "startTimeGMT": start,
        "duration": duration,
        "distance": distance,
        "intensityType": intensity,
        "wktStepIndex": step,
        "averageHR": hr,
        "maxHR": max_hr,
        "averageSpeed": speed,
        "averageRunCadence": cadence,
        "elevationGain": 0.0,
    }


def _payload():
    # Warm-up 2:22, then 4:00 run / 1:00 walk, then a run cut short.
    return {
        "activityId": AID,
        "lapDTOs": [
            _lap(1, "2026-11-11T18:49:58.0", 142.0, "WARMUP", 0, 105, 119, 1.41, 103, 200),
            _lap(2, "2026-11-11T18:52:20.0", 240.0, "ACTIVE", 1, 127, 139, 2.12, 160, 508),
            _lap(3, "2026-11-11T18:56:20.0", 60.0, "REST", 2, 132, 139, 1.47, 122, 88),
            _lap(4, "2026-11-11T18:57:20.0", 26.0, "ACTIVE", 1, 143, 146, 1.93, 155, 51),
        ],
        "eventDTOs": [],
    }


def _activity(store, aid=AID, start_utc="2026-11-11T18:49:58Z", samples=True):
    store.upsert("activities", ["activity_id"], {
        "activity_id": aid, "day": "2026-11-11", "start_time_local": "2026-11-11T21:49:58",
        "start_time_utc": start_utc, "activity_type": "running",
    })
    if samples:
        details_mod.store_samples(store, aid, [{
            "activity_id": aid, "elapsed_s": 0.0, "distance_m": 0.0, "hr": 100.0,
            "speed_mps": 1.0, "cadence_spm": 50.0, "power_w": None, "altitude_m": None,
            "lat": None, "lon": None,
        }])


class TestNormalize:
    def test_each_lap_keeps_its_intensity_and_numbers(self):
        rows = L.normalize_laps(_payload(), AID, "2026-11-11T18:49:58Z")
        assert [r["intensity"] for r in rows] == ["WARMUP", "ACTIVE", "REST", "ACTIVE"]
        assert [r["wkt_step_index"] for r in rows] == [0, 1, 2, 1]
        run = rows[1]
        assert run["duration_s"] == 240.0
        assert run["avg_hr"] == 127 and run["max_hr"] == 139
        assert run["avg_cadence_spm"] == 160 and run["distance_m"] == 508

    def test_offsets_are_measured_from_the_activity_start(self):
        rows = L.normalize_laps(_payload(), AID, "2026-11-11T18:49:58Z")
        # 18:52:20 - 18:49:58 = 142 s; 18:56:20 = 382 s; 18:57:20 = 442 s.
        assert [r["start_offset_s"] for r in rows] == [0.0, 142.0, 382.0, 442.0]

    def test_without_a_start_the_offsets_are_the_running_sum(self):
        rows = L.normalize_laps(_payload(), AID, None)
        # 0, then 142, then 142 + 240 = 382, then 382 + 60 = 442.
        assert [r["start_offset_s"] for r in rows] == [0.0, 142.0, 382.0, 442.0]

    def test_an_auto_lap_has_no_intensity(self):
        payload = {"lapDTOs": [_lap(1, "2026-11-11T18:49:58.0", 300.0, None, None)]}
        (row,) = L.normalize_laps(payload, AID, "2026-11-11T18:49:58Z")
        assert row["intensity"] is None and row["wkt_step_index"] is None

    def test_nothing_usable_is_no_laps(self):
        assert L.normalize_laps(None, AID, None) == []
        assert L.normalize_laps({}, AID, None) == []
        assert L.normalize_laps({"lapDTOs": None}, AID, None) == []


class TestSync:
    def test_fetches_archives_and_stores(self, store):
        _activity(store)
        asked: list[str] = []
        out = L.sync_activity_laps(store, AID, lambda p: asked.append(p) or _payload())
        assert asked == [f"/activity-service/activity/{AID}/splits"]
        assert out == {"activity_id": AID, "laps": 4}
        assert store.scalar("SELECT COUNT(*) FROM activity_laps WHERE activity_id = ?",
                            (AID,)) == 4
        assert store.scalar("SELECT COUNT(*) FROM raw_documents WHERE endpoint = ?",
                            (L.ENDPOINT,)) == 1

    def test_a_second_sync_replaces_rather_than_duplicates(self, store):
        _activity(store)
        L.sync_activity_laps(store, AID, lambda p: _payload())
        L.sync_activity_laps(store, AID, lambda p: _payload())
        assert store.scalar("SELECT COUNT(*) FROM activity_laps") == 4

    def test_queue_is_activities_with_a_stream_and_no_laps_newest_first(self, store):
        _activity(store, "old", "2026-10-01T06:00:00Z")
        _activity(store, "new", "2026-11-01T06:00:00Z")
        _activity(store, "gym", "2026-11-02T06:00:00Z", samples=False)
        assert L.activities_missing_laps(store) == ["new", "old"]
        # An activity Garmin had no laps for is archived and not asked about again.
        L.sync_activity_laps(store, "new", lambda p: None)
        assert L.activities_missing_laps(store) == ["old"]

    def test_reparse_rebuilds_from_the_archive(self, store):
        _activity(store)
        L.sync_activity_laps(store, AID, lambda p: _payload())
        store.conn.execute("DELETE FROM activity_laps")
        assert L.reparse_laps(store) == {"activities": 1, "laps": 4}
        assert store.scalar("SELECT COUNT(*) FROM activity_laps") == 4


class TestAutoSync:
    def test_a_new_run_gets_its_laps(self, store, settings, monkeypatch):
        settings.token_dir.mkdir(parents=True, exist_ok=True)
        connect_mod.token_file(settings.token_dir).write_text("{}")
        monkeypatch.setattr(connect_mod, "sync", lambda st, s, **kw: _activity(st))
        monkeypatch.setattr("garmin_analytics.analytics.performance.rebuild_best_efforts",
                            lambda st: 0)

        def fetch(path):
            return _payload() if path.endswith("/splits") else None

        out = A.sync_garmin(store, settings, fetcher=fetch, resume=lambda d: "runner")
        assert store.scalar("SELECT COUNT(*) FROM activity_laps") == 4
        assert out["message"] == "1 new activity, laps for 1 activity."

    def test_failed_laps_do_not_end_the_run(self, store, settings, monkeypatch):
        settings.token_dir.mkdir(parents=True, exist_ok=True)
        connect_mod.token_file(settings.token_dir).write_text("{}")
        monkeypatch.setattr(connect_mod, "sync", lambda st, s, **kw: _activity(st))
        monkeypatch.setattr("garmin_analytics.analytics.performance.rebuild_best_efforts",
                            lambda st: 0)

        def fetch(path):
            raise connect_mod.ConnectError("boom")

        out = A.sync_garmin(store, settings, fetcher=fetch, resume=lambda d: "runner")
        assert out["state"] == "done"
        assert out["message"] == "1 new activity."


class TestApi:
    def test_activity_detail_lists_its_laps_in_order(self, store, settings):
        _activity(store)
        L.sync_activity_laps(store, AID, lambda p: _payload())
        body = TestClient(create_app(settings)).get(f"/api/activities/{AID}").json()
        assert [lap["intensity"] for lap in body["laps"]] == ["WARMUP", "ACTIVE", "REST",
                                                             "ACTIVE"]
        assert body["laps"][1] == {
            "lap_index": 2, "start_offset_s": 142.0, "duration_s": 240.0,
            "distance_m": 508.0, "intensity": "ACTIVE", "wkt_step_index": 1,
            "avg_hr": 127.0, "max_hr": 139.0, "avg_speed_mps": 2.12,
            "avg_cadence_spm": 160.0, "elevation_gain_m": 0.0,
        }

    def test_no_laps_is_an_empty_list(self, store, settings):
        _activity(store)
        body = TestClient(create_app(settings)).get(f"/api/activities/{AID}").json()
        assert body["laps"] == []
