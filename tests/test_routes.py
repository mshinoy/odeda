"""Route clustering, segment analysis and the map payloads.

Clustering is a heuristic, so the tests that matter most are the **negative** ones:
two different routes must not be merged, and a short out-and-back must not be
swallowed by the longer route that contains it. A clusterer that merges everything
scores perfectly on positive tests alone.
"""

from __future__ import annotations

import math

import pytest

from garmin_analytics.analytics import routes as R

# One degree of latitude is ~111 320 m. Small helper so the fixtures below can be
# written in metres and read as geometry rather than as coordinates.
DEG = 1.0 / 111_320.0


def _line(lat0, lon0, points, jitter_m=0.0, seed=1):
    """A straight-ish track of `points` samples heading north, 10 m apart."""
    import random

    rng = random.Random(seed)
    out = []
    for i in range(points):
        lat = lat0 + i * 10 * DEG
        lon = lon0
        if jitter_m:
            lat += rng.gauss(0, jitter_m) * DEG
            lon += rng.gauss(0, jitter_m) * DEG / math.cos(math.radians(lat0))
        out.append((lat, lon))
    return out


def _store_track(store, activity_id, latlngs, day="2026-01-01",
                 activity_type="running", speed=3.0, hr=150.0, alt=10.0):
    """Write an activity plus a GPS sample stream, 10 m and ~3.3 s apart."""
    total = 10.0 * (len(latlngs) - 1)
    store.upsert("activities", ["activity_id"], {
        "activity_id": activity_id,
        "day": day,
        "start_time_local": f"{day}T06:30:00",
        "activity_type": activity_type,
        "activity_name": "Run",
        "distance_m": total,
        "duration_s": total / speed,
        "moving_time_s": total / speed,
        "avg_hr": hr,
        "avg_speed_mps": speed,
        "elevation_gain_m": 0.0,
    })
    rows = []
    for i, (lat, lon) in enumerate(latlngs):
        rows.append((activity_id, round(i * 10.0 / speed, 3), i * 10.0, hr, speed,
                     180.0, None, alt, lat, lon))
    store.conn.executemany(
        "INSERT OR REPLACE INTO activity_samples (activity_id, elapsed_s, distance_m, "
        "hr, speed_mps, cadence_spm, power_w, altitude_m, lat, lon) "
        "VALUES (?,?,?,?,?,?,?,?,?,?)", rows)
    store.conn.commit()
    return activity_id


class TestGeometry:
    def test_haversine_against_a_known_distance(self):
        """One degree of latitude at the equator is 110 574 m (WGS-84)."""
        d = R.haversine(0.0, 0.0, 1.0, 0.0)
        assert d == pytest.approx(111_195, rel=0.002)   # spherical earth, R=6371008.8

    def test_haversine_is_zero_for_the_same_point(self):
        assert R.haversine(25.28, 51.53, 25.28, 51.53) == pytest.approx(0.0)

    def test_resample_returns_exactly_n_points(self):
        pts = _line(25.0, 51.0, 37)
        assert len(R.resample(pts, 100)) == 100

    def test_resample_keeps_the_endpoints(self):
        pts = _line(25.0, 51.0, 37)
        out = R.resample(pts, 50)
        assert out[0] == pytest.approx(pts[0], abs=1e-9)
        assert out[-1] == pytest.approx(pts[-1], abs=1e-6)

    def test_resample_is_even_by_distance(self):
        """Two tracks of the same shape at different sample rates must line up."""
        dense = _line(25.0, 51.0, 200)
        sparse = [dense[i] for i in range(0, 200, 7)] + [dense[-1]]
        assert R.similarity(R.resample(dense), R.resample(sparse)) > 0.99

    def test_path_length(self):
        pts = _line(25.0, 51.0, 11)     # 10 gaps of 10 m
        assert R.path_length(pts) == pytest.approx(100.0, rel=0.01)

    def test_similarity_is_one_for_an_identical_track(self):
        pts = R.resample(_line(25.0, 51.0, 50))
        assert R.similarity(pts, pts) == pytest.approx(1.0)

    def test_gps_noise_does_not_break_similarity(self):
        a = R.resample(_line(25.0, 51.0, 120, jitter_m=6, seed=1))
        b = R.resample(_line(25.0, 51.0, 120, jitter_m=6, seed=2))
        assert R.similarity(a, b) > 0.9

    def test_parallel_streets_are_not_the_same_route(self):
        """200 m apart is a different road, not GPS drift."""
        a = R.resample(_line(25.0, 51.0, 120))
        b = R.resample(_line(25.0, 51.0 + 200 * DEG / math.cos(math.radians(25)), 120))
        assert R.similarity(a, b) < 0.1

    def test_similarity_is_symmetric(self):
        a = R.resample(_line(25.0, 51.0, 120, jitter_m=4, seed=3))
        b = R.resample(_line(25.0, 51.0, 120, jitter_m=4, seed=4))
        assert R.similarity(a, b) == pytest.approx(R.similarity(b, a), abs=0.02)

    def test_a_subset_track_does_not_score_as_a_match(self):
        """Half of a route lies exactly on it; taking the min is what catches this."""
        full = R.resample(_line(25.0, 51.0, 200))
        half = R.resample(_line(25.0, 51.0, 100))
        assert R.similarity(half, full) < R.MATCH_THRESHOLD


class TestClustering:
    def test_repeat_runs_collapse_into_one_route(self, store):
        for i in range(5):
            _store_track(store, f"a{i}", _line(25.0, 51.0, 120, jitter_m=5, seed=i),
                         day=f"2026-01-0{i + 1}")
        out = R.cluster_all(store)
        assert out["routes"] == 1
        assert out["created"] == 1
        assert out["joined"] == 4

    def test_two_different_routes_stay_apart(self, store):
        """The failure that matters: everything merged into one useless cluster."""
        for i in range(3):
            _store_track(store, f"north{i}", _line(25.0, 51.0, 120, jitter_m=4, seed=i))
        for i in range(3):
            _store_track(store, f"east{i}",
                         _line(25.1, 51.2, 120, jitter_m=4, seed=10 + i))
        out = R.cluster_all(store)
        assert out["routes"] == 2

    def test_same_length_routes_in_different_places_stay_apart(self, store):
        """Distance alone must not be the signal — these are both 1 190 m."""
        _store_track(store, "a", _line(25.00, 51.00, 120, jitter_m=3, seed=1))
        _store_track(store, "b", _line(25.05, 51.00, 120, jitter_m=3, seed=2))
        assert R.cluster_all(store)["routes"] == 2

    def test_different_sports_never_share_a_route(self, store):
        _store_track(store, "run", _line(25.0, 51.0, 120), activity_type="running")
        _store_track(store, "ride", _line(25.0, 51.0, 120), activity_type="cycling")
        assert R.cluster_all(store)["routes"] == 2

    def test_indoor_activities_are_skipped_not_crashed_on(self, store):
        """An activity with no GPS must be an ordinary case, not an exception."""
        store.upsert("activities", ["activity_id"], {
            "activity_id": "treadmill", "day": "2026-01-01",
            "start_time_local": "2026-01-01T06:00:00",
            "activity_type": "treadmill_running", "activity_name": "Treadmill",
            "distance_m": 8000.0, "duration_s": 2400.0, "moving_time_s": 2400.0,
        })
        store.conn.commit()
        _store_track(store, "outdoor", _line(25.0, 51.0, 120))
        out = R.cluster_all(store)
        assert out["routes"] == 1
        assert R.activity_track(store, "treadmill")["has_gps"] is False

    def test_a_track_too_short_to_matter_is_ignored(self, store):
        _store_track(store, "tiny", _line(25.0, 51.0, 12))    # 110 m
        out = R.cluster_all(store)
        assert out["routes"] == 0
        assert out["too_short"] == 1

    def test_clustering_is_idempotent(self, store):
        for i in range(4):
            _store_track(store, f"a{i}", _line(25.0, 51.0, 120, jitter_m=5, seed=i))
        first = R.cluster_all(store)
        second = R.cluster_all(store)
        assert second["routes"] == first["routes"]
        assert second["created"] == 0

    def test_manual_assignment_survives_reclustering(self, store):
        """A route the user has corrected must not be silently re-filed."""
        for i in range(3):
            _store_track(store, f"a{i}", _line(25.0, 51.0, 120, jitter_m=4, seed=i))
        _store_track(store, "other", _line(25.2, 51.3, 120))
        R.cluster_all(store)
        other_route = store.query(
            "SELECT route_id FROM route_members WHERE activity_id = 'other'")[0]["route_id"]
        R.move_activity(store, "a0", other_route)

        R.cluster_all(store)
        still = store.query(
            "SELECT route_id, assigned FROM route_members WHERE activity_id = 'a0'")[0]
        assert still["route_id"] == other_route
        assert still["assigned"] == "manual"


class TestUserCorrections:
    @pytest.fixture
    def clustered(self, store):
        for i in range(4):
            _store_track(store, f"a{i}", _line(25.0, 51.0, 120, jitter_m=4, seed=i),
                         day=f"2026-01-0{i + 1}")
        for i in range(3):
            _store_track(store, f"b{i}", _line(25.3, 51.4, 120, jitter_m=4, seed=20 + i),
                         day=f"2026-02-0{i + 1}")
        R.cluster_all(store)
        return store

    def test_rename_pins_the_route(self, clustered, store):
        rid = R.list_routes(store)[0]["route_id"]
        out = R.rename(store, rid, "Corniche loop")
        assert out["name"] == "Corniche loop"
        assert R.route_detail(store, rid)["route"]["pinned"] is True

    def test_rename_rejects_an_empty_name(self, clustered, store):
        rid = R.list_routes(store)[0]["route_id"]
        with pytest.raises(ValueError):
            R.rename(store, rid, "   ")

    def test_merge_moves_members_and_drops_the_source(self, clustered, store):
        routes = R.list_routes(store)
        target, source = routes[0]["route_id"], routes[1]["route_id"]
        total = routes[0]["attempts"] + routes[1]["attempts"]
        out = R.merge(store, target, [source])
        assert out["moved_activities"] == routes[1]["attempts"]
        assert len(R.list_routes(store)) == 1
        assert R.route_detail(store, target)["attempt_count"] == total

    def test_split_creates_a_new_route(self, clustered, store):
        rid = R.list_routes(store)[0]["route_id"]
        members = [a["activity_id"] for a in R.route_detail(store, rid)["attempts"]]
        out = R.split(store, rid, members[:2], name="Split off")
        assert out["moved"] == 2
        assert R.route_detail(store, out["route_id"])["attempt_count"] == 2
        assert R.route_detail(store, rid)["attempt_count"] == len(members) - 2

    def test_split_refuses_to_empty_a_route(self, clustered, store):
        rid = R.list_routes(store)[0]["route_id"]
        members = [a["activity_id"] for a in R.route_detail(store, rid)["attempts"]]
        with pytest.raises(ValueError):
            R.split(store, rid, members)

    def test_deleting_a_route_keeps_its_activities(self, clustered, store):
        rid = R.list_routes(store)[0]["route_id"]
        before = store.scalar("SELECT COUNT(*) FROM activities")
        assert R.delete_route(store, rid) is True
        assert store.scalar("SELECT COUNT(*) FROM activities") == before

    def test_a_route_with_no_members_left_is_removed(self, clustered, store):
        rid = R.list_routes(store)[0]["route_id"]
        store.conn.execute("DELETE FROM route_members WHERE route_id = ?", (rid,))
        store.conn.commit()
        R.refresh_route(store, rid)
        assert not store.query("SELECT 1 FROM routes WHERE route_id = ?", (rid,))


class TestSegments:
    def test_segments_cover_the_route_in_fixed_steps(self, store):
        # 400 samples 10 m apart = 3 990 m, at a 200 m segment size = 19 whole segments.
        for i in range(3):
            _store_track(store, f"a{i}", _line(25.0, 51.0, 400, jitter_m=3, seed=i))
        R.cluster_all(store)
        rid = R.list_routes(store)[0]["route_id"]
        profile = R.segment_profile(store, rid)
        assert profile["segment_m"] == 200.0
        assert profile["attempts"] == 3
        assert len(profile["segments"]) == 19
        assert profile["segments"][0]["start_m"] == 0.0
        assert profile["segments"][1]["start_m"] == 200.0

    def test_relative_speed_is_one_when_pace_is_constant(self, store):
        """No variation in the track means every segment sits at the average."""
        for i in range(3):
            _store_track(store, f"a{i}", _line(25.0, 51.0, 400, jitter_m=2, seed=i))
        R.cluster_all(store)
        rid = R.list_routes(store)[0]["route_id"]
        for seg in R.segment_profile(store, rid)["segments"]:
            assert seg["relative_speed"] == pytest.approx(1.0, abs=0.05)

    def test_a_slow_stretch_shows_up_as_the_slowest_segment(self, store):
        """Build a track that is genuinely slow between 1 000 m and 1 200 m."""
        pts = _line(25.0, 51.0, 400)
        for aid in ("a0", "a1", "a2"):
            store.upsert("activities", ["activity_id"], {
                "activity_id": aid, "day": "2026-01-01",
                "start_time_local": "2026-01-01T06:00:00",
                "activity_type": "running", "activity_name": "Run",
                "distance_m": 3990.0, "duration_s": 1400.0, "moving_time_s": 1400.0,
                "avg_hr": 150.0, "avg_speed_mps": 2.85,
            })
            rows, t = [], 0.0
            for i, (lat, lon) in enumerate(pts):
                d = i * 10.0
                speed = 1.5 if 1000 <= d < 1200 else 3.0     # half speed in that stretch
                rows.append((aid, round(t, 3), d, 150.0, speed, 180.0, None, 10.0,
                             lat, lon))
                t += 10.0 / speed
            store.conn.executemany(
                "INSERT OR REPLACE INTO activity_samples (activity_id, elapsed_s, "
                "distance_m, hr, speed_mps, cadence_spm, power_w, altitude_m, lat, lon) "
                "VALUES (?,?,?,?,?,?,?,?,?,?)", rows)
        store.conn.commit()
        R.cluster_all(store)
        rid = R.list_routes(store)[0]["route_id"]
        profile = R.segment_profile(store, rid)

        slowest = profile["slowest_segments"][0]
        assert slowest["start_m"] == 1000.0
        assert slowest["relative_speed"] < 0.6
        # And the rest of the route is at, or slightly above, the average.
        assert profile["fastest_segments"][0]["relative_speed"] > 1.0

    def test_gradient_is_rise_over_run(self, store):
        """10 m of climb over a 200 m segment is 5 %."""
        pts = _line(25.0, 51.0, 400)
        aid = "climb"
        store.upsert("activities", ["activity_id"], {
            "activity_id": aid, "day": "2026-01-01",
            "start_time_local": "2026-01-01T06:00:00", "activity_type": "running",
            "activity_name": "Run", "distance_m": 3990.0, "duration_s": 1330.0,
            "moving_time_s": 1330.0, "avg_speed_mps": 3.0,
        })
        rows = []
        for i, (lat, lon) in enumerate(pts):
            d = i * 10.0
            rows.append((aid, round(d / 3.0, 3), d, 150.0, 3.0, 180.0, None,
                         10.0 + d * 0.05, lat, lon))   # 5 % gradient throughout
        store.conn.executemany(
            "INSERT OR REPLACE INTO activity_samples (activity_id, elapsed_s, distance_m, "
            "hr, speed_mps, cadence_spm, power_w, altitude_m, lat, lon) "
            "VALUES (?,?,?,?,?,?,?,?,?,?)", rows)
        store.conn.commit()
        R.cluster_all(store)
        rid = R.list_routes(store)[0]["route_id"]
        seg = R.segment_profile(store, rid)["segments"][3]
        assert seg["median_gradient_pct"] == pytest.approx(5.0, abs=0.2)

    def test_segment_size_scales_with_route_length(self):
        assert R.segment_length_for(5_000) == 200.0
        assert R.segment_length_for(20_000) == 500.0
        assert R.segment_length_for(80_000) == 1000.0

    def test_profile_of_a_route_with_no_efforts_is_empty_not_an_error(self, store):
        _store_track(store, "a", _line(25.0, 51.0, 120))
        R.cluster_all(store)
        rid = R.list_routes(store)[0]["route_id"]
        store.conn.execute("DELETE FROM route_segment_efforts")
        store.conn.commit()
        assert R.segment_profile(store, rid)["segments"] == []


class TestPayloads:
    def test_activity_track_shape(self, store):
        _store_track(store, "a", _line(25.0, 51.0, 50))
        track = R.activity_track(store, "a")
        assert track["has_gps"] is True
        assert track["point_count"] == 50
        assert len(track["points"][0]) == len(track["fields"])
        assert track["bounds"]["min_lat"] < track["bounds"]["max_lat"]

    def test_track_of_an_unknown_activity_is_empty_not_an_error(self, store):
        track = R.activity_track(store, "ghost")
        assert track["has_gps"] is False
        assert track["points"] == []
        assert track["bounds"] is None

    def test_heatmap_counts_repeated_visits(self, store):
        for i in range(4):
            _store_track(store, f"a{i}", _line(25.0, 51.0, 60), day=f"2026-01-0{i + 1}")
        heat = R.heatmap(store, precision=3)
        assert heat["cells"] > 0
        assert heat["max_count"] >= 4          # the same cell, visited on four runs
        assert len(heat["points"][0]) == 3

    def test_heatmap_respects_exclude_from_stats(self, store):
        from garmin_analytics.edits import overrides as ov

        _store_track(store, "a", _line(25.0, 51.0, 60))
        before = R.heatmap(store, precision=4)["cells"]
        ov.set_override(store, "a", "excluded_from_stats", True)
        assert R.heatmap(store, precision=4)["cells"] < before

    def test_route_detail_reports_improvement(self, store):
        """First attempt slow, last attempt fast — improvement is positive seconds."""
        _store_track(store, "slow", _line(25.0, 51.0, 200, jitter_m=3, seed=1),
                     day="2026-01-01", speed=2.5)
        _store_track(store, "fast", _line(25.0, 51.0, 200, jitter_m=3, seed=2),
                     day="2026-06-01", speed=3.5)
        R.cluster_all(store)
        rid = R.list_routes(store)[0]["route_id"]
        stats = R.route_detail(store, rid)["stats"]
        assert stats["improvement_s"] > 0
        assert stats["best_time_s"] < stats["worst_time_s"]

    def test_excluded_attempts_do_not_set_the_record(self, store):
        from garmin_analytics.edits import overrides as ov

        _store_track(store, "normal", _line(25.0, 51.0, 200, jitter_m=3, seed=1),
                     day="2026-01-01", speed=3.0)
        _store_track(store, "in_a_car", _line(25.0, 51.0, 200, jitter_m=3, seed=2),
                     day="2026-02-01", speed=20.0)
        R.cluster_all(store)
        rid = R.list_routes(store)[0]["route_id"]
        ov.set_override(store, "in_a_car", "excluded_from_stats", True)
        detail = R.route_detail(store, rid)
        assert detail["attempt_count"] == 2          # still listed
        assert detail["counted_count"] == 1          # but not counted
        assert detail["best_attempt"]["activity_id"] == "normal"

    def test_compare_returns_both_tracks(self, store):
        _store_track(store, "a", _line(25.0, 51.0, 60), day="2026-01-01")
        _store_track(store, "b", _line(25.0, 51.0, 60), day="2026-02-01")
        out = R.compare(store, ["a", "b"])
        assert out["count"] == 2
        assert all(x["track"]["has_gps"] for x in out["attempts"])
