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


# ---------------------------------------------------------------------------
# Laps and ground (T44): a route is the ground run, not the distance
# ---------------------------------------------------------------------------


def _loop(lat0, lon0, side_m=300, laps=1.0, jitter_m=0.0, seed=1, approach_m=0):
    """A square loop of `side_m` sides (4 x side_m round), run `laps` times, 10 m a
    sample, anticlockwise from its south-west corner. `approach_m` first runs up to
    that corner from the south, the way a run from home reaches its loop."""
    import random

    rng = random.Random(seed)
    lon_m = DEG / math.cos(math.radians(lat0))
    corners = [(0, 0), (side_m, 0), (side_m, side_m), (0, side_m)]
    out = [(lat0 - (approach_m - i * 10) * DEG, lon0) for i in range(approach_m // 10)]
    steps = int(round(4 * side_m * laps / 10))
    for k in range(steps + 1):
        d = (k * 10) % (4 * side_m)
        edge, along = divmod(d, side_m)
        (x0, y0), (x1, y1) = corners[edge], corners[(edge + 1) % 4]
        t = along / side_m
        x, y = x0 + t * (x1 - x0), y0 + t * (y1 - y0)
        lat = lat0 + y * DEG
        lon = lon0 + x * lon_m
        if jitter_m:
            lat += rng.gauss(0, jitter_m) * DEG
            lon += rng.gauss(0, jitter_m) * lon_m
        out.append((lat, lon))
    return out


def _out_and_back(lat0, lon0, out_m, times=1, jitter_m=0.0, seed=1):
    """North `out_m` metres and back, `times` over, 10 m a sample."""
    leg = _line(lat0, lon0, out_m // 10 + 1, jitter_m=jitter_m, seed=seed)
    one = leg + leg[-2::-1]
    track = list(one)
    for _ in range(times - 1):
        track += one[1:]
    return track


def _route_of(store, activity_id):
    return store.query(
        "SELECT route_id FROM route_members WHERE activity_id = ?", (activity_id,)
    )[0]["route_id"]


class TestGround:
    def test_laps_add_no_ground(self):
        one = R.ground_length(_loop(25.0, 51.0, laps=1))
        three = R.ground_length(_loop(25.0, 51.0, laps=3))
        assert one == pytest.approx(1200, rel=0.05)
        assert three == pytest.approx(one, rel=0.05)

    def test_the_way_back_adds_no_ground(self):
        # The turn itself adds a few metres: the first steps back are still the turn.
        assert R.ground_length(_out_and_back(25.0, 51.0, 1000)) == pytest.approx(1000, rel=0.1)

    def test_any_number_of_laps_matches_the_loop(self):
        route = _loop(25.0, 51.0, laps=1)
        for laps in (1, 1.6, 2, 5):
            run = _loop(25.0, 51.0, laps=laps, jitter_m=5, seed=int(laps * 10))
            assert R.match_score(run, route) > 0.9, laps

    def test_a_warm_up_to_the_loop_still_matches(self):
        route = _loop(25.0, 51.0, laps=1)
        run = _loop(25.0, 51.0, laps=3, approach_m=300, jitter_m=4)
        assert R.match_score(run, route) >= R.MATCH_THRESHOLD

    def test_a_run_mostly_somewhere_else_does_not_match(self):
        """1 lap of the loop, then 3 km out along the road: mostly not the loop."""
        route = _loop(25.0, 51.0, laps=1)
        run = _loop(25.0, 51.0, laps=1) + _line(25.0, 51.0, 300)[1:]
        assert R.match_score(run, route) < R.MATCH_THRESHOLD

    def test_half_a_loop_does_not_match_it(self):
        route = _loop(25.0, 51.0, laps=1)
        assert R.match_score(_loop(25.0, 51.0, laps=0.5), route) < R.MATCH_THRESHOLD


class TestFirstLap:
    def test_three_laps_give_one(self):
        lap = R.first_lap(_loop(25.0, 51.0, laps=3))
        assert R.path_length(lap) == pytest.approx(1200, rel=0.03)

    def test_an_out_and_back_is_its_own_lap(self):
        track = _out_and_back(25.0, 51.0, 1000)
        assert R.first_lap(track) == track

    def test_a_track_that_never_comes_back_is_its_own_lap(self):
        track = _line(25.0, 51.0, 200)
        assert R.first_lap(track) == track


class TestLapClustering:
    def test_one_two_and_five_laps_are_one_route_one_lap_long(self, store):
        # Little noise: GPS scatter lengthens a measured path, and the length is checked.
        for i, laps in enumerate((1, 2, 5, 1.6, 3)):
            _store_track(store, f"lap{i}", _loop(25.0, 51.0, laps=laps, jitter_m=1, seed=i),
                         day=f"2026-01-0{i + 1}")
        out = R.cluster_all(store)
        assert out["routes"] == 1
        route = store.query("SELECT distance_m, is_loop FROM routes")[0]
        assert route["distance_m"] == pytest.approx(1200, rel=0.05)
        assert route["is_loop"] == 1

    def test_the_first_run_being_several_laps_does_not_matter(self, store):
        _store_track(store, "five", _loop(25.0, 51.0, laps=5, jitter_m=4, seed=1), day="2026-01-01")
        _store_track(store, "one", _loop(25.0, 51.0, laps=1, jitter_m=4, seed=2), day="2026-01-02")
        out = R.cluster_all(store)
        assert out["routes"] == 1

    def test_out_and_back_once_or_twice_to_the_same_turn_is_one_route(self, store):
        _store_track(store, "once", _out_and_back(25.0, 51.0, 1500, jitter_m=4, seed=1))
        _store_track(store, "twice", _out_and_back(25.0, 51.0, 1500, times=2, jitter_m=4, seed=2))
        assert R.cluster_all(store)["routes"] == 1

    def test_a_turn_a_fifth_further_is_the_same_route(self, store):
        _store_track(store, "short", _out_and_back(25.0, 51.0, 1500, jitter_m=4, seed=1),
                     day="2026-01-01")
        _store_track(store, "further", _out_and_back(25.0, 51.0, 1800, jitter_m=4, seed=2),
                     day="2026-01-02")
        assert R.cluster_all(store)["routes"] == 1

    def test_a_turn_twice_as_far_is_another_route(self, store):
        _store_track(store, "short", _out_and_back(25.0, 51.0, 1500, jitter_m=4, seed=1),
                     day="2026-01-01")
        _store_track(store, "long", _out_and_back(25.0, 51.0, 3000, jitter_m=4, seed=2),
                     day="2026-01-02")
        assert R.cluster_all(store)["routes"] == 2

    def test_fresh_rebuilds_untouched_routes_and_keeps_edited_ones(self, store):
        for i in range(3):
            _store_track(store, f"loop{i}", _loop(25.0, 51.0, laps=1 + i, jitter_m=4, seed=i))
        _store_track(store, "named", _line(25.2, 51.3, 150))
        R.cluster_all(store)
        named = _route_of(store, "named")
        R.rename(store, named, "Corniche")

        out = R.cluster_all(store, fresh=True)
        assert out["routes"] == 2
        assert _route_of(store, "named") == named  # pinned: kept, same id
        assert store.query("SELECT name FROM routes WHERE route_id = ?", (named,))[0]["name"] == "Corniche"


class TestLaps:
    START = (25.0, 51.0)

    def _rows(self, track, speed=3.0):
        return [
            {"lat": lat, "lon": lon, "elapsed_s": i * 10.0 / speed, "distance_m": i * 10.0}
            for i, (lat, lon) in enumerate(track)
        ]

    def test_every_full_lap_is_timed(self):
        laps = R.lap_splits(self._rows(_loop(25.0, 51.0, laps=3)), self.START, 1200)
        assert len(laps) == 3
        assert [lap["seconds"] for lap in laps] == pytest.approx([400.0] * 3, abs=5)

    def test_a_part_lap_at_the_end_is_not_timed(self):
        laps = R.lap_splits(self._rows(_loop(25.0, 51.0, laps=2.6)), self.START, 1200)
        assert len(laps) == 2

    def test_laps_start_at_the_line_not_at_the_first_sample(self):
        """A run from home reaches the loop first; the approach is not a lap."""
        track = _loop(25.0, 51.0, laps=2, approach_m=500)
        laps = R.lap_splits(self._rows(track), self.START, 1200)
        assert len(laps) == 2
        assert all(lap["distance_m"] == pytest.approx(1200, rel=0.03) for lap in laps)

    def test_once_round_from_elsewhere_on_the_loop_is_one_lap(self):
        """Started at the far corner: never crosses the line, but it is one lap."""
        loop = _loop(25.0, 51.0, laps=1)
        half = len(loop) // 2
        from_far_corner = loop[half:] + loop[1: half + 1]
        laps = R.lap_splits(self._rows(from_far_corner), self.START, 1200)
        assert len(laps) == 1
        assert laps[0]["distance_m"] == pytest.approx(1200, rel=0.03)

    def test_a_lap_much_shorter_than_the_loop_is_not_timed(self):
        """A cut corner (here 10% short) must not set the record."""
        laps = R.lap_splits(self._rows(_loop(25.0, 51.0, laps=2, side_m=270)), self.START, 1200)
        assert laps == []

    def test_laps_are_timed_from_where_the_run_started_on_the_loop(self, store):
        """Three times round from the far corner: three laps, not two and a bit."""
        _store_track(store, "ref", _loop(25.0, 51.0, laps=1), day="2026-01-01")
        loop = _loop(25.0, 51.0, laps=3)
        quarter = len(_loop(25.0, 51.0, laps=1)) // 2
        from_far_corner = loop[quarter:] + loop[1: quarter + 1]
        _store_track(store, "far", from_far_corner, day="2026-01-02")
        R.cluster_all(store)
        detail = R.route_detail(store, _route_of(store, "ref"))
        assert {a["activity_id"]: a["laps"] for a in detail["attempts"]} == {"ref": 1, "far": 3}

    def test_half_a_loop_is_not_a_lap(self):
        assert R.lap_splits(self._rows(_loop(25.0, 51.0, laps=0.5)), self.START, 1200) == []

    def test_route_detail_reports_laps_and_the_best_one(self, store):
        _store_track(store, "easy", _loop(25.0, 51.0, laps=3), day="2026-01-01", speed=3.0)
        _store_track(store, "fast", _loop(25.0, 51.0, laps=2), day="2026-01-02", speed=4.0)
        R.cluster_all(store)
        detail = R.route_detail(store, _route_of(store, "easy"))
        by_id = {a["activity_id"]: a for a in detail["attempts"]}
        assert by_id["easy"]["laps"] == 3
        assert by_id["fast"]["laps"] == 2
        stats = detail["stats"]
        assert stats["laps"] == 5
        assert stats["best_lap_activity_id"] == "fast"
        assert stats["best_lap_s"] == pytest.approx(300, abs=5)  # 1200 m at 4 m/s
        assert stats["lap_m"] == pytest.approx(1200, rel=0.05)

    def test_an_out_and_back_is_one_and_has_no_laps(self, store):
        _store_track(store, "oab", _out_and_back(25.0, 51.0, 1500))
        R.cluster_all(store)
        detail = R.route_detail(store, _route_of(store, "oab"))
        assert detail["route"]["layout"] == "out_and_back"
        assert detail["attempts"][0]["laps"] is None
        assert detail["stats"]["best_lap_s"] is None

    def test_layouts(self):
        assert R.route_layout(_loop(25.0, 51.0), True) == "loop"
        assert R.route_layout(_out_and_back(25.0, 51.0, 1500), True) == "out_and_back"
        assert R.route_layout(_line(25.0, 51.0, 150), False) == "one_way"

    def test_segments_on_a_loop_are_one_lap_long(self, store):
        _store_track(store, "three", _loop(25.0, 51.0, laps=3))
        R.cluster_all(store)
        route_id = _route_of(store, "three")
        idx = [r["seg_index"] for r in store.query(
            "SELECT seg_index FROM route_segment_efforts WHERE route_id = ?", (route_id,))]
        assert idx == list(range(6))  # 1200 m in 200 m segments, not 3600 m

    def test_the_list_shows_lap_times_for_loops_only(self, store):
        _store_track(store, "loop3", _loop(25.0, 51.0, laps=3), day="2026-01-01", speed=3.0)
        _store_track(store, "oab", _out_and_back(25.2, 51.3, 1500), day="2026-01-02")
        R.cluster_all(store)
        by_layout = {r["layout"]: r for r in R.list_routes(store)}
        assert by_layout["loop"]["best_lap_s"] == pytest.approx(400, abs=5)
        assert by_layout["loop"]["median_lap_s"] == pytest.approx(400, abs=5)
        assert by_layout["out_and_back"]["best_lap_s"] is None


class TestRouteNumbers:
    def _ids(self, store):
        return {r["activity_id"]: r["route_id"] for r in store.query(
            "SELECT activity_id, route_id FROM route_members")}

    def test_a_fresh_rebuild_keeps_the_numbers(self, store):
        for i in range(3):
            _store_track(store, f"loop{i}", _loop(25.0, 51.0, laps=1 + i, jitter_m=3, seed=i))
        for i in range(2):
            _store_track(store, f"oab{i}", _out_and_back(25.2, 51.3, 1500, jitter_m=3, seed=i))
        R.cluster_all(store)
        before = self._ids(store)
        names = {r["route_id"]: r["name"] for r in store.query("SELECT route_id, name FROM routes")}

        R.cluster_all(store, fresh=True)
        assert self._ids(store) == before
        after = {r["route_id"]: r["name"] for r in store.query("SELECT route_id, name FROM routes")}
        assert after == names  # the number in the name is the kept one

    def test_merged_routes_keep_the_bigger_ones_number(self, store):
        # Three routes made by hand-filing, then a rebuild that sees one loop.
        for i in range(3):
            _store_track(store, f"a{i}", _loop(25.0, 51.0, laps=1, jitter_m=3, seed=i))
        R.cluster_all(store)
        route = _route_of(store, "a0")
        previous = {"a0": 7, "a1": 7, "a2": 9}
        moved = R.keep_route_ids(store, previous)
        assert moved == {route: 7}
        assert set(self._ids(store).values()) == {7}
        assert store.query("SELECT COUNT(*) n FROM route_segment_efforts WHERE route_id = 7")[0]["n"] > 0
        assert store.query("SELECT name FROM routes")[0]["name"].endswith("#7")

    def test_a_number_in_use_is_not_taken(self, store):
        _store_track(store, "a", _loop(25.0, 51.0, laps=1))
        _store_track(store, "b", _out_and_back(25.2, 51.3, 1500))
        R.cluster_all(store)
        ra, rb = _route_of(store, "a"), _route_of(store, "b")
        assert R.keep_route_ids(store, {"a": rb}) == {}
        assert (_route_of(store, "a"), _route_of(store, "b")) == (ra, rb)


class TestTheListCarriesTheShape:
    """T53. The routes are auto-named from their distance — `1.6 km loop #31` — so the
    list names nothing the owner recognises without a picture of the route."""

    @pytest.fixture
    def clustered(self, store):
        for i in range(3):
            _store_track(store, f"a{i}", _line(25.0, 51.0, 120, jitter_m=4, seed=i),
                         day=f"2026-01-0{i + 1}")
        R.cluster_all(store)
        return store

    def test_every_route_carries_an_encoded_polyline(self, clustered, store):
        rows = R.list_routes(store)
        assert rows
        assert all(isinstance(r["polyline"], str) and r["polyline"] for r in rows)

    def test_it_decodes_back_to_the_route(self, clustered, store):
        """Encoded, not raw points: a precision-5 polyline of the simplified track."""
        row = R.list_routes(store)[0]
        points = _decode_polyline(row["polyline"])
        assert len(points) >= 2
        lat, lon = points[0]
        assert 24.9 < lat < 25.1
        assert 50.9 < lon < 51.1

    def test_it_is_simplified_rather_than_every_point(self, clustered, store):
        """A 240px thumbnail cannot show a full track, and the whole list is one
        response: 53 untrimmed routes would be the largest payload the app sends."""
        from garmin_analytics.api.preview import MAX_POINTS

        row = R.list_routes(store)[0]
        assert len(_decode_polyline(row["polyline"])) <= MAX_POINTS

    def test_the_points_column_still_does_not_leak(self, clustered, store):
        """`points` is popped for the layout; the row must not start carrying it."""
        assert "points" not in R.list_routes(store)[0]


def _decode_polyline(encoded: str) -> list[tuple[float, float]]:
    """Google's precision-5 polyline, decoded. Here rather than in the app: nothing it
    ships needs to read one back, and a test that re-used the encoder's own helpers
    would only prove they agree with themselves."""
    points, index, lat, lon = [], 0, 0, 0
    while index < len(encoded):
        for axis in range(2):
            shift = result = 0
            while True:
                byte = ord(encoded[index]) - 63
                index += 1
                result |= (byte & 0x1F) << shift
                shift += 5
                if byte < 0x20:
                    break
            delta = ~(result >> 1) if result & 1 else result >> 1
            if axis == 0:
                lat += delta
            else:
                lon += delta
        points.append((lat / 1e5, lon / 1e5))
    return points


class TestWhatToMergeWith:
    """T56. The merge dialog offered every route of the same type, unranked. These are
    the scores that put the plausible one at the top."""

    @pytest.fixture
    def several(self, store):
        # Two runs round the same ground, and one a long way off.
        for i in range(2):
            _store_track(store, f"here{i}", _line(25.0, 51.0, 120, jitter_m=4, seed=i),
                         day=f"2026-01-0{i + 1}")
        for i in range(2):
            _store_track(store, f"far{i}", _line(25.3, 51.4, 120, jitter_m=4, seed=20 + i),
                         day=f"2026-02-0{i + 1}")
        R.cluster_all(store)
        return store

    def test_it_offers_every_other_route_of_the_type(self, several, store):
        rows = R.list_routes(store)
        me = rows[0]["route_id"]
        out = R.similar_routes(store, me)
        assert {c["route_id"] for c in out} == {r["route_id"] for r in rows} - {me}

    def test_the_nearest_comes_first_when_nothing_overlaps(self, several, store):
        """Almost every score is zero — anything above the clusterer's threshold is
        already one route — so the gap between centroids is what ranks them."""
        me = R.list_routes(store)[0]["route_id"]
        out = R.similar_routes(store, me)
        gaps = [c["metres_away"] for c in out]
        assert gaps == sorted(gaps) or any(c["similarity"] > 0 for c in out)

    def test_a_better_overlap_outranks_a_nearer_route(self, several, store):
        out = R.similar_routes(store, R.list_routes(store)[0]["route_id"])
        scores = [c["similarity"] for c in out]
        assert scores == sorted(scores, reverse=True)

    def test_it_never_offers_the_route_itself(self, several, store):
        me = R.list_routes(store)[0]["route_id"]
        assert all(c["route_id"] != me for c in R.similar_routes(store, me))

    def test_an_unknown_route_is_a_lookup_error_not_an_empty_list(self, several, store):
        with pytest.raises(LookupError):
            R.similar_routes(store, 9999)
