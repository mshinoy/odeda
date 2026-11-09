"""Recording gaps (`analytics/gaps.py`): where the watch paused and resumed elsewhere,
and a guess at the path ridden in between, from the rider's own history."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from garmin_analytics.analytics import gaps as G
from garmin_analytics.api.server import create_app

A = (25.3173, 51.4965)
B = (25.2837, 51.5590)
M1 = (25.3100, 51.5100)
M2 = (25.3000, 51.5300)
M3 = (25.2900, 51.5450)


def _add(store, activity_id: str, activity_type: str, samples) -> None:
    """`samples`: (elapsed_s, distance_m, lat, lon)."""
    with store.tx():
        store.upsert("activities", ["activity_id"], {
            "activity_id": activity_id, "day": "2026-10-24",
            "start_time_local": "2026-10-24T05:00:00", "activity_type": activity_type,
            "activity_name": f"Ride {activity_id}",
        })
        store.conn.executemany(
            "INSERT INTO activity_samples (activity_id, elapsed_s, distance_m, lat, lon) "
            "VALUES (?, ?, ?, ?, ?)",
            [(activity_id, e, d, la, lo) for e, d, la, lo in samples],
        )


def _gappy_ride(store, activity_id: str = "gappy", activity_type: str = "cycling") -> None:
    """Recorded to A, paused 28 minutes, resumed at B. The device's own distance did not
    move across the gap."""
    _add(store, activity_id, activity_type, [
        (0.0, 0.0, 25.3200, 51.4900), (100.0, 600.0, 25.3185, 51.4940),
        (764.0, 4000.0, *A),
        (2471.0, 4010.0, *B), (2571.0, 4500.0, 25.2830, 51.5600),
    ])


def _past_ride(store, activity_id: str = "past", activity_type: str = "cycling", reverse: bool = False) -> None:
    """A ride on another day that went A, M1, M2, M3, B."""
    way = [A, M1, M2, M3, B]
    if reverse:
        way = way[::-1]
    _add(store, activity_id, activity_type,
         [(float(i * 200), float(i * 2000), la, lo) for i, (la, lo) in enumerate(way)])


class TestFindGaps:
    def test_finds_the_one_gap_with_its_two_ends(self, store):
        _gappy_ride(store)
        gaps = G.find_gaps([
            (0.0, 0.0, 25.3200, 51.4900), (764.0, 4000.0, *A), (2471.0, 4010.0, *B),
            (2571.0, 4500.0, 25.2830, 51.5600),
        ])
        assert len(gaps) == 1
        gap = gaps[0]
        assert gap["seconds"] == pytest.approx(1707.0)
        assert gap["straight_m"] == pytest.approx(7_300, abs=300)
        assert (gap["before"]["lat"], gap["after"]["lat"]) == (A[0], B[0])

    def test_a_ride_with_no_gap_has_none(self):
        samples = [(float(i), float(i * 5), 25.0 + i * 1e-4, 51.0) for i in range(10)]
        assert G.find_gaps(samples) == []


class TestEstimate:
    def test_borrows_the_path_another_ride_took_between_the_two_ends(self, store):
        _gappy_ride(store)
        _past_ride(store)
        [gap] = G.activity_gaps(store, "gappy")
        est = gap["estimate"]
        assert est is not None
        assert est["source_activity_id"] == "past"
        assert est["path"][0] == A and est["path"][-1] == B
        assert M2 in est["path"]
        assert est["length_m"] > gap["straight_m"]

    def test_the_speed_is_the_length_over_the_time_the_gap_took(self, store):
        _gappy_ride(store)
        _past_ride(store)
        [gap] = G.activity_gaps(store, "gappy")
        est = gap["estimate"]
        assert est["avg_speed_mps"] == pytest.approx(est["length_m"] / 1707.0)
        assert est["avg_speed_mps"] < G.MAX_SPEED_MPS["wheels"]

    def test_the_source_is_named_so_the_guess_can_be_checked(self, store):
        _gappy_ride(store)
        _past_ride(store)
        [gap] = G.activity_gaps(store, "gappy")
        assert gap["estimate"]["source_day"] == "2026-10-24"
        assert gap["estimate"]["source_name"] == "Ride past"

    def test_nothing_else_in_the_history_means_no_estimate(self, store):
        _gappy_ride(store)
        [gap] = G.activity_gaps(store, "gappy")
        assert gap["estimate"] is None

    def test_the_other_way_round_is_the_other_carriageway_and_is_not_used(self, store):
        _gappy_ride(store)
        _past_ride(store, reverse=True)
        [gap] = G.activity_gaps(store, "gappy")
        assert gap["estimate"] is None

    def test_a_run_does_not_fill_a_ride(self, store):
        _gappy_ride(store)
        _past_ride(store, activity_type="running")
        [gap] = G.activity_gaps(store, "gappy")
        assert gap["estimate"] is None

    def test_a_path_too_fast_for_the_time_is_not_what_happened(self, store):
        """Eight kilometres of path in 70 seconds is not a ride that took 28 minutes."""
        _gappy_ride(store)
        _past_ride(store)
        gap = G.find_gaps([(764.0, 4000.0, *A), (834.0, 4010.0, *B)])[0]
        assert G.estimate_fill(store, "gappy", "cycling", gap) is None

    def test_the_shortest_of_several_rides_wins(self, store):
        _gappy_ride(store)
        _past_ride(store, "long")
        # A second ride that cut straight across.
        _add(store, "short", "cycling", [(0.0, 0.0, *A), (400.0, 7400.0, *B)])
        [gap] = G.activity_gaps(store, "gappy")
        assert gap["estimate"]["source_activity_id"] == "short"

    def test_an_unknown_activity_has_no_gaps(self, store):
        assert G.activity_gaps(store, "nope") == []

    def test_the_activity_itself_is_never_its_own_source(self, store):
        _gappy_ride(store)
        [gap] = G.activity_gaps(store, "gappy")
        assert gap["estimate"] is None


class TestEndpoint:
    @pytest.fixture
    def client(self, settings):
        return TestClient(create_app(settings))

    def test_the_gaps_of_an_activity_with_an_estimate(self, client, store):
        _gappy_ride(store)
        _past_ride(store)
        body = client.get("/api/activities/gappy/gaps").json()
        assert body["activity_id"] == "gappy"
        [gap] = body["gaps"]
        est = gap["estimate"]
        assert est["lat"][0] == A[0] and est["lon"][-1] == B[1]
        assert len(est["lat"]) == len(est["lon"])
        assert est["source_activity_id"] == "past"

    def test_an_activity_with_no_gap_has_an_empty_list(self, client, store):
        _past_ride(store)
        assert client.get("/api/activities/past/gaps").json()["gaps"] == []

    def test_an_unknown_activity_is_a_404(self, client):
        assert client.get("/api/activities/nope/gaps").status_code == 404
