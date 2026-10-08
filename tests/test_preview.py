"""What the activity list's cards draw (`api/preview.py`): the simplified, encoded route
and the HR zones each list row carries. A gym row's exercises are in `test_gym.py`."""

from __future__ import annotations

import math

import pytest
from fastapi.testclient import TestClient

from garmin_analytics.api import preview as preview_mod
from garmin_analytics.api.preview import MAX_POINTS, encode_polyline, simplify
from garmin_analytics.api.server import create_app


def decode_polyline(encoded: str) -> list[tuple[float, float]]:
    """The reverse of `encode_polyline`, written out here so the test does not trust it."""
    points: list[tuple[float, float]] = []
    index = lat = lon = 0
    while index < len(encoded):
        deltas = []
        for _ in range(2):
            shift = result = 0
            while True:
                byte = ord(encoded[index]) - 63
                index += 1
                result |= (byte & 0x1F) << shift
                shift += 5
                if byte < 0x20:
                    break
            deltas.append(~(result >> 1) if result & 1 else result >> 1)
        lat += deltas[0]
        lon += deltas[1]
        points.append((lat / 1e5, lon / 1e5))
    return points


class TestEncode:
    def test_googles_own_example(self):
        # From Google's "Encoded Polyline Algorithm Format" page.
        points = [(38.5, -120.2), (40.7, -120.95), (43.252, -126.453)]
        assert encode_polyline(points) == "_p~iF~ps|U_ulLnnqC_mqNvxq`@"

    def test_round_trip(self):
        points = [(25.28541, 51.53104), (25.28602, 51.53001), (25.0, 51.0), (-33.9, 18.4)]
        assert decode_polyline(encode_polyline(points)) == points

    def test_nothing(self):
        assert encode_polyline([]) == ""


class TestSimplify:
    def test_a_straight_line_is_its_two_ends(self):
        line = [(25.0 + i * 1e-4, 51.0 + i * 1e-4) for i in range(500)]
        assert simplify(line) == [line[0], line[-1]]

    def test_a_winding_track_is_capped_and_keeps_its_ends(self):
        # A spiral: every point is a real bend, so only the cap thins it.
        track = [
            (25.0 + 0.01 * (i / 2000) * math.sin(i / 10), 51.0 + 0.01 * (i / 2000) * math.cos(i / 10))
            for i in range(2000)
        ]
        out = simplify(track)
        assert len(out) == MAX_POINTS
        assert out[0] == track[0]
        assert out[-1] == track[-1]
        assert out == [p for p in track if p in set(out)]  # a subset, in order

    def test_a_corner_survives(self):
        track = [(25.0, 51.0 + i * 1e-4) for i in range(100)] + [
            (25.0 + i * 1e-4, 51.0099) for i in range(1, 100)
        ]
        assert (25.0, 51.0099) in simplify(track)

    @pytest.mark.parametrize("track", [[], [(25.0, 51.0)], [(25.0, 51.0), (25.1, 51.1)]])
    def test_short_tracks_are_kept_whole(self, track):
        assert simplify(track) == track


@pytest.fixture
def client(seeded_db):
    return TestClient(create_app(seeded_db))


class TestListRows:
    def _row(self, client, type_: str) -> dict:
        return client.get(f"/api/activities?type={type_}&limit=1").json()["rows"][0]

    def test_an_outdoor_run_carries_its_route(self, client, seeded_store):
        row = self._row(client, "running")
        points = decode_polyline(row["preview_polyline"])
        assert 2 <= len(points) <= MAX_POINTS
        first = seeded_store.query(
            "SELECT lat, lon FROM activity_samples WHERE activity_id = ? AND lat IS NOT NULL "
            "ORDER BY elapsed_s LIMIT 1",
            (row["activity_id"],),
        )[0]
        assert points[0] == pytest.approx((first["lat"], first["lon"]), abs=1e-5)

    def test_an_indoor_run_has_none(self, client):
        assert self._row(client, "treadmill_running")["preview_polyline"] is None

    def test_hr_zones_are_the_stored_ones(self, client, seeded_store):
        row = self._row(client, "running")
        stored = seeded_store.query(
            "SELECT zone, seconds FROM activity_hr_zones WHERE activity_id = ? ORDER BY zone",
            (row["activity_id"],),
        )
        assert stored, "the seed should give a run its zones"
        assert row["hr_zones"] == stored

    def test_every_row_has_the_card_fields(self, client):
        rows = client.get("/api/activities?limit=100").json()["rows"]
        for row in rows:
            assert {"preview_polyline", "hr_zones", "exercises"} <= row.keys()
            if row["total_sets"] is None:
                assert row["exercises"] == []

    def test_the_detail_endpoint_is_unchanged(self, client):
        aid = self._row(client, "running")["activity_id"]
        act = client.get(f"/api/activities/{aid}").json()["activity"]
        assert "preview_polyline" not in act


class TestRouteCache:
    def _add(self, store, activity_id: str, track: list[tuple[float, float]]) -> None:
        with store.tx():
            store.upsert("activities", ["activity_id"], {
                "activity_id": activity_id, "day": "2026-10-01",
                "start_time_local": "2026-10-01T07:00:00", "activity_type": "running",
            })
            store.conn.execute("DELETE FROM activity_samples WHERE activity_id = ?", (activity_id,))
            store.conn.executemany(
                "INSERT INTO activity_samples (activity_id, elapsed_s, lat, lon) VALUES (?, ?, ?, ?)",
                [(activity_id, float(i), lat, lon) for i, (lat, lon) in enumerate(track)],
            )

    def _route(self, store, activity_id: str) -> list[tuple[float, float]]:
        rows = preview_mod.with_card_extras(store, [{"activity_id": activity_id, "total_sets": None}])
        return decode_polyline(rows[0]["preview_polyline"])

    def test_a_resynced_track_is_drawn_again(self, store):
        self._add(store, "a1", [(25.0, 51.0), (25.01, 51.01)])
        assert self._route(store, "a1") == [(25.0, 51.0), (25.01, 51.01)]
        self._add(store, "a1", [(25.0, 51.0), (25.02, 51.0), (25.02, 51.02)])
        assert self._route(store, "a1") == [(25.0, 51.0), (25.02, 51.0), (25.02, 51.02)]

    def test_an_activity_without_gps_has_no_route(self, store):
        self._add(store, "a2", [])
        rows = preview_mod.with_card_extras(store, [{"activity_id": "a2", "total_sets": None}])
        assert rows[0]["preview_polyline"] is None
