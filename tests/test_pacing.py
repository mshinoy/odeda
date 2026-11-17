"""The race-day pacing plan (`analytics/pacing.py`)."""

from __future__ import annotations

from datetime import date

import pytest
from fastapi.testclient import TestClient

from conftest import add_calendar_race
from odeda.analytics import pacing as P
from odeda.api.server import create_app

DISTANCE = 21097.5
TARGET = 12600.0  # 3:30:00
STEP = 0.00018  # about 20 m of latitude


def gpx_file(path, points):
    body = "".join(f'<trkpt lat="{la:.6f}" lon="{lo:.6f}"/>' for la, lo in points)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        '<?xml version="1.0"?><gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">'
        f"<trk><trkseg>{body}</trkseg></trk></gpx>"
    )


def out_and_back(km_out: float):
    """Straight north for `km_out`, a U-turn, and straight back on the same road."""
    n = int(km_out * 1000 / 20)
    out = [(25.0 + i * STEP, 51.0) for i in range(n)]
    return out + [(25.0 + (n - 1) * STEP, 51.0002)] + out[::-1]


class TestSplitPlan:
    def test_the_splits_add_up_to_the_target_exactly(self):
        rows = P.split_plan(TARGET, DISTANCE, [5200, 10500, 16100])
        assert sum(r["split_s"] for r in rows) == pytest.approx(TARGET, abs=0.05)
        assert rows[-1]["cum_s"] == pytest.approx(TARGET, abs=0.05)

    def test_it_is_twenty_one_kilometres_and_a_bit(self):
        rows = P.split_plan(TARGET, DISTANCE)
        assert len(rows) == 22
        assert [r["distance_m"] for r in rows[:21]] == [1000.0] * 21
        assert rows[-1]["distance_m"] == pytest.approx(97.5)
        assert rows[-1]["end_m"] == pytest.approx(DISTANCE)

    def test_the_first_kilometre_is_gentler_and_the_rest_even(self):
        rows = P.split_plan(TARGET, DISTANCE)
        paces = [r["pace_s_per_km"] for r in rows[:21]]
        assert paces[0] > paces[1]
        assert paces[1] == pytest.approx(paces[10], abs=0.2)

    def test_a_turn_costs_time_in_the_kilometre_it_falls_in(self):
        flat = P.split_plan(TARGET, DISTANCE)
        turny = P.split_plan(TARGET, DISTANCE, [10500])
        assert turny[10]["split_s"] > flat[10]["split_s"] + P.TURN_COST_S * 0.8
        # Every other kilometre gives a little back, so the target still holds.
        assert turny[3]["split_s"] < flat[3]["split_s"]
        assert sum(r["split_s"] for r in turny) == pytest.approx(TARGET, abs=0.05)

    def test_negative_makes_the_second_half_faster(self):
        rows = P.split_plan(TARGET, DISTANCE, strategy="negative")
        first = sum(r["split_s"] for r in rows[:10])
        second = sum(r["split_s"] for r in rows[11:21])
        assert second < first
        assert sum(r["split_s"] for r in rows) == pytest.approx(TARGET, abs=0.05)

    def test_even_is_not_a_negative_split_in_disguise(self):
        rows = P.split_plan(TARGET, DISTANCE)
        first = sum(r["split_s"] for r in rows[1:10])
        second = sum(r["split_s"] for r in rows[11:20])
        assert second == pytest.approx(first, rel=0.01)

    def test_a_turn_past_the_finish_lands_in_the_last_kilometre_not_off_the_end(self):
        rows = P.split_plan(TARGET, DISTANCE, [999_999])
        assert sum(r["split_s"] for r in rows) == pytest.approx(TARGET, abs=0.05)

    def test_nonsense_is_refused(self):
        with pytest.raises(ValueError):
            P.split_plan(TARGET, DISTANCE, strategy="sprint")
        with pytest.raises(ValueError):
            P.split_plan(0, DISTANCE)
        with pytest.raises(ValueError):
            P.split_plan(TARGET, 0)


class TestCourse:
    def test_reads_a_gpx_track(self, tmp_path):
        f = tmp_path / "c.gpx"
        gpx_file(f, out_and_back(2))
        assert len(P.read_gpx(f)) > 100

    def test_a_file_with_no_track_is_an_error(self, tmp_path):
        f = tmp_path / "empty.gpx"
        f.write_text('<?xml version="1.0"?><gpx xmlns="http://www.topografix.com/GPX/1/1"></gpx>')
        with pytest.raises(ValueError):
            P.read_gpx(f)

    def test_an_out_and_back_has_one_turnaround_about_halfway(self, tmp_path):
        f = tmp_path / "c.gpx"
        gpx_file(f, out_and_back(5))
        profile = P.course_profile(P.read_gpx(f))
        assert profile["length_m"] == pytest.approx(10_000, rel=0.03)
        [turn] = profile["turns"]
        assert turn["kind"] == "turnaround"
        assert turn["at_m"] == pytest.approx(5_000, abs=150)

    def test_a_straight_road_has_no_turns(self, tmp_path):
        f = tmp_path / "c.gpx"
        gpx_file(f, [(25.0 + i * STEP, 51.0) for i in range(500)])
        assert P.course_profile(P.read_gpx(f))["turns"] == []

    def test_a_right_angle_is_a_turn_not_a_turnaround(self, tmp_path):
        f = tmp_path / "c.gpx"
        north = [(25.0 + i * STEP, 51.0) for i in range(100)]
        east = [(25.0 + 99 * STEP, 51.0 + j * 0.00020) for j in range(1, 100)]
        gpx_file(f, north + east)
        [turn] = P.course_profile(P.read_gpx(f))["turns"]
        assert turn["kind"] == "turn"

    def test_the_course_lives_in_the_data_directory_under_the_race_date(self, tmp_path):
        assert P.course_path(tmp_path, "2027-01-15") == tmp_path / "courses" / "2027-01-15.gpx"


class TestComputePacing:
    TODAY = date(2026, 12, 1)

    def test_no_race_is_an_empty_plan(self, store, settings):
        out = P.compute_pacing(store, settings, today=self.TODAY)
        assert out["race"] is None and out["splits"] == []

    def test_a_target_gives_the_plan_with_no_course_when_there_is_no_file(self, store, settings):
        add_calendar_race(store)
        out = P.compute_pacing(store, settings, TARGET, today=self.TODAY)
        assert out["course"]["source"] == "none"
        assert out["target_s"] == TARGET
        assert sum(r["split_s"] for r in out["splits"]) == pytest.approx(TARGET, abs=0.05)

    def test_a_gpx_in_the_data_directory_adds_its_turns(self, store, settings):
        add_calendar_race(store)
        gpx_file(P.course_path(settings.data_dir, "2027-01-15"), out_and_back(10.5))
        out = P.compute_pacing(store, settings, TARGET, today=self.TODAY)
        assert out["course"]["source"] == "gpx"
        [turn] = out["course"]["turns"]
        assert turn["kind"] == "turnaround"
        # On the race's own distance: halfway of 21.1 km, not of the file's length.
        assert turn["km"] == pytest.approx(10.5, abs=0.4)

    def test_a_broken_file_is_ignored_not_fatal(self, store, settings):
        add_calendar_race(store)
        broken = P.course_path(settings.data_dir, "2027-01-15")
        broken.parent.mkdir(parents=True)
        broken.write_text("this is not xml")
        out = P.compute_pacing(store, settings, TARGET, today=self.TODAY)
        assert out["course"]["source"] == "none"
        assert out["splits"]

    def test_a_race_with_no_distance_has_no_plan(self, store, settings):
        add_calendar_race(store, distance_m=None)
        assert P.compute_pacing(store, settings, TARGET, today=self.TODAY)["splits"] == []


class TestEndpoint:
    @pytest.fixture
    def client(self, settings):
        return TestClient(create_app(settings))

    def test_the_plan_for_a_target(self, client, store):
        add_calendar_race(store)
        body = client.get("/api/race/pacing", params={"target_s": 12600}).json()
        assert body["target_s"] == 12600
        assert body["strategy"] == "even"
        assert len(body["splits"]) == 22
        assert body["splits"][-1]["cum_s"] == pytest.approx(12600, abs=0.1)

    def test_a_strategy_is_chosen_by_name(self, client, store):
        add_calendar_race(store)
        body = client.get("/api/race/pacing", params={"target_s": 12600, "strategy": "negative"}).json()
        assert body["strategy"] == "negative"

    def test_a_silly_target_or_strategy_is_a_422(self, client, store):
        add_calendar_race(store)
        assert client.get("/api/race/pacing", params={"target_s": 60}).status_code == 422
        assert client.get("/api/race/pacing", params={"strategy": "sprint"}).status_code == 422

    def test_no_race_is_an_empty_plan_not_an_error(self, client):
        body = client.get("/api/race/pacing").json()
        assert body["race"] is None and body["splits"] == []
