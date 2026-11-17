"""What the activity list's cards draw (`api/preview.py`): the simplified, encoded route
and the HR zones each list row carries. A gym row's exercises are in `test_gym.py`."""

from __future__ import annotations

import math

import pytest
from fastapi.testclient import TestClient

from odeda.api import preview as preview_mod
from odeda.api.preview import MAX_POINTS, encode_polyline, simplify
from odeda.api.server import create_app


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

    def test_says_which_activities_have_a_route(self, client):
        assert self._row(client, "running")["has_gps"] is True
        assert self._row(client, "treadmill_running")["has_gps"] is False

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
            assert {"has_gps", "hr_zones", "exercises"} <= row.keys()
            assert "preview_polyline" not in row  # the list does not wait for routes
            if row["total_sets"] is None:
                assert row["exercises"] == []

    def test_the_detail_endpoint_is_unchanged(self, client):
        aid = self._row(client, "running")["activity_id"]
        act = client.get(f"/api/activities/{aid}").json()["activity"]
        assert "has_gps" not in act


class TestPreviews:
    def _ids(self, client, type_: str, n: int = 3) -> list[str]:
        rows = client.get(f"/api/activities?type={type_}&limit={n}").json()["rows"]
        return [r["activity_id"] for r in rows]

    def test_an_outdoor_run_has_its_route(self, client, seeded_store):
        aid = self._ids(client, "running", 1)[0]
        body = client.get("/api/activities/previews", params={"ids": [aid]}).json()
        points = decode_polyline(body["polylines"][aid])
        assert 2 <= len(points) <= MAX_POINTS
        first = seeded_store.query(
            "SELECT lat, lon FROM activity_samples WHERE activity_id = ? AND lat IS NOT NULL "
            "ORDER BY elapsed_s LIMIT 1",
            (aid,),
        )[0]
        assert points[0] == pytest.approx((first["lat"], first["lon"]), abs=1e-5)

    def test_only_activities_with_gps_are_in_it(self, client):
        runs = self._ids(client, "running")
        indoor = self._ids(client, "treadmill_running")
        body = client.get("/api/activities/previews", params={"ids": runs + indoor + ["nope"]})
        assert body.status_code == 200
        assert set(body.json()["polylines"]) == set(runs)

    def test_a_page_at_most(self, client):
        res = client.get("/api/activities/previews", params={"ids": [str(i) for i in range(201)]})
        assert res.status_code == 400

    def test_ids_are_required(self, client):
        assert client.get("/api/activities/previews").status_code == 422


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

    def test_a_resynced_track_is_drawn_again(self, store):
        self._add(store, "a1", [(25.0, 51.0), (25.01, 51.01)])
        first = preview_mod.polylines(store, ["a1"])["a1"]
        assert decode_polyline(first) == [(25.0, 51.0), (25.01, 51.01)]
        self._add(store, "a1", [(25.0, 51.0), (25.02, 51.0), (25.02, 51.02)])
        again = preview_mod.polylines(store, ["a1"])["a1"]
        assert decode_polyline(again) == [(25.0, 51.0), (25.02, 51.0), (25.02, 51.02)]

    def test_an_activity_without_gps_has_no_route(self, store):
        self._add(store, "a2", [])
        assert preview_mod.polylines(store, ["a2"]) == {}
        row = preview_mod.with_card_extras(store, [{"activity_id": "a2", "total_sets": None}])[0]
        assert row["has_gps"] is False


class TestRecordingGaps:
    """A watch that paused and resumed somewhere else must not have a line drawn across
    the gap: on one real ride that was a 7 km straight line across the bay."""

    # (elapsed_s, recorded distance m, lat, lon)
    BEFORE = (764.0, 4000.0, 25.3173, 51.4965)
    ACROSS = (2471.0, 4010.0, 25.2837, 51.5590)

    def test_a_pause_that_ended_far_away_with_no_distance_recorded_is_a_gap(self):
        assert preview_mod.is_recording_gap(self.BEFORE, self.ACROSS)

    def test_a_tunnel_is_not(self):
        """The signal went but the distance was still counted."""
        after = (830.0, 5100.0, 25.3173, 51.5066)
        assert not preview_mod.is_recording_gap(self.BEFORE, after)

    def test_a_short_pause_is_not(self):
        after = (790.0, 4000.0, 25.3173, 51.5066)
        assert not preview_mod.is_recording_gap(self.BEFORE, after)

    def test_a_long_pause_that_ended_where_it_began_is_not(self):
        after = (2471.0, 4000.0, 25.3174, 51.4966)
        assert not preview_mod.is_recording_gap(self.BEFORE, after)

    def test_no_recorded_distance_means_a_long_pause_and_a_long_way_is_enough(self):
        before = (self.BEFORE[0], None, self.BEFORE[2], self.BEFORE[3])
        after = (self.ACROSS[0], None, self.ACROSS[2], self.ACROSS[3])
        assert preview_mod.is_recording_gap(before, after)

    def test_a_track_is_split_into_what_was_recorded(self):
        samples = [
            (0.0, 3990.0, 25.3170, 51.4960),
            (10.0, 4000.0, 25.3172, 51.4962),
            self.ACROSS,
            (2481.0, 4020.0, 25.2838, 51.5591),
        ]
        pieces = preview_mod.split_at_gaps(samples)
        assert [len(p) for p in pieces] == [2, 2]

    def test_a_track_with_no_gap_is_one_piece(self):
        samples = [(float(i), float(i * 5), 25.0 + i * 1e-4, 51.0) for i in range(5)]
        assert len(preview_mod.split_at_gaps(samples)) == 1

    def test_a_piece_of_one_point_is_dropped(self):
        samples = [
            (0.0, 3990.0, 25.3170, 51.4960),
            (10.0, 4000.0, 25.3172, 51.4962),
            self.ACROSS,
        ]
        assert [len(p) for p in preview_mod.split_at_gaps(samples)] == [2]

    def test_the_route_comes_out_as_pieces_joined_by_a_separator(self, store):
        with store.tx():
            store.upsert("activities", ["activity_id"], {
                "activity_id": "gap1", "day": "2026-11-07",
                "start_time_local": "2026-11-07T05:39:00", "activity_type": "cycling",
            })
            store.conn.executemany(
                "INSERT INTO activity_samples (activity_id, elapsed_s, distance_m, lat, lon) "
                "VALUES (?, ?, ?, ?, ?)",
                [("gap1", e, d, la, lo) for e, d, la, lo in (
                    (0.0, 3990.0, 25.3170, 51.4960), (10.0, 4000.0, 25.3172, 51.4962),
                    (2471.0, 4010.0, 25.2837, 51.5590), (2481.0, 4020.0, 25.2838, 51.5591),
                )],
            )
        encoded = preview_mod.polylines(store, ["gap1"])["gap1"]
        pieces = encoded.split(preview_mod.PIECE_SEPARATOR)
        assert len(pieces) == 2
        assert decode_polyline(pieces[0])[0] == (25.317, 51.496)
        assert decode_polyline(pieces[1])[-1] == (25.2838, 51.5591)

    def test_the_separator_is_not_in_the_polyline_alphabet(self):
        assert not (63 <= ord(preview_mod.PIECE_SEPARATOR) <= 126)
