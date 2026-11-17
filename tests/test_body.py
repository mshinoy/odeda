"""Body-composition analytics.

The claim this whole module rests on is that a single scale reading is mostly
hydration, so everything is computed on a smoothed series. That claim is only worth
anything if the smoothing is right, and "right" here has two halves that pull against
each other: it has to suppress the day-to-day noise, and it has to not be fooled by a
gap. Most of these tests are about the second half, because the first is easy.

Where a number is asserted it is hand-derived, with the derivation in the comment, as
`CONTRIBUTING.md` asks for the maths tests.
"""

from __future__ import annotations

from datetime import date, timedelta

import pytest

from odeda.analytics import body as B


def daily(start: str, values: list[float | None]) -> tuple[list[str], list[float | None]]:
    first = date.fromisoformat(start)
    return [(first + timedelta(days=i)).isoformat() for i in range(len(values))], values


class TestSmoothing:
    def test_the_first_reading_is_the_trend(self):
        """There is nothing to average it against, and seeding from zero would open
        every chart with a line climbing out of the floor."""
        days, values = daily("2026-01-01", [76.0])
        assert B.smooth(days, values) == [76.0]

    def test_a_steady_weight_smooths_to_itself(self):
        days, values = daily("2026-01-01", [76.0] * 20)
        assert B.smooth(days, values)[-1] == pytest.approx(76.0)

    def test_a_seven_day_half_life_moves_halfway_in_seven_days(self):
        """The definition, checked against itself.

        Step up by 1 kg and hold it. After seven daily readings the trend must have
        closed half the gap: 76.0 -> 76.5, because the per-day decay is 0.5**(1/7) and
        seven of them is 0.5 exactly.
        """
        days, values = daily("2026-01-01", [76.0] + [77.0] * 7)
        assert B.smooth(days, values)[-1] == pytest.approx(76.5, abs=0.01)

    def test_noise_is_suppressed_far_more_than_a_real_change(self):
        """The argument for the whole approach, as an inequality.

        Alternating ±0.6 kg around 76 — pure hydration — must leave the trend within
        0.2 kg of 76. A sustained 1 kg gain over the same span must move it much
        further. Same smoother, opposite verdicts, which is the point.
        """
        noisy_days, noisy = daily("2026-01-01", [76.6 if i % 2 else 75.4 for i in range(30)])
        real_days, real = daily("2026-01-01", [76.0 + i * 1.0 / 29 for i in range(30)])
        assert abs(B.smooth(noisy_days, noisy)[-1] - 76.0) < 0.2
        assert B.smooth(real_days, real)[-1] > 76.5

    def test_one_reading_after_a_long_gap_cannot_become_the_trend(self):
        """The property the textbook version gets wrong.

        Continuous-time EWMA sends the weight on a new reading to 1 as the gap grows,
        so a reading after a month away *replaces* the trend. That is right about the
        old estimate being stale and wrong about the new one being reliable: it is one
        number with ±0.6 kg of hydration in it, taken after a fortnight of not weighing.

        Steady at 76, then nothing for 30 days, then 80. The trend must move — ignoring
        it would be worse — but it must not arrive: MAX_STEP is 0.5, so it goes half
        way, to 78.
        """
        values: list[float | None] = [76.0] * 14 + [None] * 30 + [80.0]
        days, values = daily("2026-01-01", values)
        trend = B.smooth(days, values)
        assert trend[-1] == pytest.approx(78.0, abs=0.05)

    def test_weighing_in_again_does_re_establish_the_trend(self):
        """A gap slows the trend down; it does not stop it responding.

        The first reading back closes half the gap, to 78. After that the readings are
        consecutive mornings again, so the ordinary 7-day half-life resumes: seven more
        of them close half of what is left, 78 -> 79.
        """
        values: list[float | None] = [76.0] * 14 + [None] * 30 + [80.0] * 8
        days, values = daily("2026-01-01", values)
        assert B.smooth(days, values)[-1] == pytest.approx(79.0, abs=0.05)

    def test_a_gap_carries_the_trend_across_rather_than_breaking_the_line(self):
        values: list[float | None] = [76.0, None, None, None, 76.0]
        days, values = daily("2026-01-01", values)
        assert B.smooth(days, values) == [76.0, 76.0, 76.0, 76.0, pytest.approx(76.0)]

    def test_nothing_before_the_first_reading(self):
        values: list[float | None] = [None, None, 76.0]
        days, values = daily("2026-01-01", values)
        assert B.smooth(days, values)[:2] == [None, None]

    def test_an_empty_series_is_empty(self):
        assert B.smooth([], []) == []


class TestSlope:
    def test_a_known_line(self):
        """0.1 kg a day for ten days is a slope of 0.1. Fitted on dates, so it is a
        rate rather than a per-sample difference."""
        days, values = daily("2026-01-01", [76.0 + 0.1 * i for i in range(10)])
        assert B.slope_per_day(days, values) == pytest.approx(0.1)

    def test_a_gap_counts_as_the_time_it_was(self):
        """The reason the fit is on ordinal dates. Two readings 1 kg apart over 10 days
        is -0.1 kg/day, whether or not there were readings in between."""
        assert B.slope_per_day(["2026-01-01", "2026-01-11"], [76.0, 75.0]) == pytest.approx(-0.1)

    def test_one_point_is_not_a_line(self):
        assert B.slope_per_day(["2026-01-01"], [76.0]) is None

    def test_a_flat_series_has_no_slope_rather_than_a_crash(self):
        assert B.slope_per_day(["2026-01-01", "2026-01-01"], [76.0, 76.0]) is None


class TestComposition:
    def test_fat_and_lean_come_out_of_weight_and_percentage(self):
        """80.0 kg at 20.0 % is 16.0 kg of fat and 64.0 kg of lean. On the scale a
        kilogram of each is the same kilogram; here they are opposite news."""
        rows = [{"day": "2026-01-01", "weight_kg": 80.0, "body_fat_pct": 20.0, "bmi": 25.0}]
        series = B.composition(rows)
        assert series["fat_kg"] == [16.0]
        assert series["lean_kg"] == [64.0]

    def test_the_axis_has_no_holes_in_it(self):
        """A sparse axis closes the gaps and claims the scale was used every day."""
        rows = [
            {"day": "2026-01-01", "weight_kg": 76.0, "body_fat_pct": None, "bmi": None},
            {"day": "2026-01-10", "weight_kg": 75.5, "body_fat_pct": None, "bmi": None},
        ]
        series = B.composition(rows)
        assert len(series["days"]) == 10
        assert series["weight_kg"][1:9] == [None] * 8
        assert all(v is not None for v in series["trend_kg"])

    def test_a_weight_without_a_body_fat_reading_has_no_split(self):
        rows = [{"day": "2026-01-01", "weight_kg": 76.0, "body_fat_pct": None, "bmi": None}]
        series = B.composition(rows)
        assert series["fat_kg"] == [None] and series["lean_kg"] == [None]

    def test_nothing_weighed_is_empty_rather_than_null_filled(self):
        assert B.composition([])["days"] == []


class TestConsistency:
    def test_it_counts_readings_against_the_span_they_cover(self):
        """Five readings over nine days: 55.6 % coverage, 3.89 a week, and the longest
        run of days without one is 3 (the 3rd to the 6th)."""
        rows = [
            {"day": d} for d in
            ("2026-01-01", "2026-01-02", "2026-01-06", "2026-01-07", "2026-01-09")
        ]
        result = B.consistency(rows, today=date(2026, 1, 10))
        assert result["readings"] == 5
        assert result["span_days"] == 9
        assert result["coverage_pct"] == pytest.approx(55.6, abs=0.1)
        assert result["per_week"] == pytest.approx(3.89, abs=0.01)
        assert result["longest_gap_days"] == 3
        assert result["days_since_last"] == 1

    def test_consecutive_mornings_are_a_gap_of_zero(self):
        rows = [{"day": "2026-01-01"}, {"day": "2026-01-02"}]
        assert B.consistency(rows, today=date(2026, 1, 2))["longest_gap_days"] == 0

    def test_nothing_weighed_reports_zeroes_not_nulls(self):
        result = B.consistency([], today=date(2026, 1, 1))
        assert result["readings"] == 0 and result["coverage_pct"] == 0.0


#: The goal race as the calendar now supplies it (T57). It was `config.RACE_*`, and a
#: unit test of a straight-line projection should state its own target.
HALF = {
    "name": "Ooredoo Doha Half Marathon",
    "date": "2027-01-15",
    "start_local": "07:35",
    "timezone": "Asia/Qatar",
    "distance_m": 21097.5,
}


class TestProjection:
    def steady_loss(self, per_week: float, days: int = 120, end=date(2026, 9, 22)):
        start = end - timedelta(days=days - 1)
        rows = [
            {
                "day": (start + timedelta(days=i)).isoformat(),
                "weight_kg": 80.0 - per_week / 7.0 * i,
                "body_fat_pct": 18.0,
                "bmi": None,
            }
            for i in range(days)
        ]
        return B.composition(rows)

    def test_a_steady_loss_projects_to_race_day(self):
        """Losing 0.35 kg a week from 2026-09-22, with the race 115 days out, is
        115/7 x 0.35 = 5.75 kg. Asserted loosely because the trend lags the readings
        by about a half-life, which is a real property and not an error.
        """
        series = self.steady_loss(0.35)
        result = B.race_projection(series, HALF, today=date(2026, 9, 22))
        assert result is not None
        assert result["days_out"] == 115
        assert result["slope_kg_per_week"] == pytest.approx(-0.35, abs=0.02)
        assert result["change_kg"] == pytest.approx(-5.75, abs=0.4)
        assert result["race_day"] == "2027-01-15"

    def test_a_steady_weight_projects_no_change(self):
        series = self.steady_loss(0.0)
        result = B.race_projection(series, HALF, today=date(2026, 9, 22))
        assert result["change_kg"] == pytest.approx(0.0, abs=0.1)
        assert result["rule_of_thumb_s_per_km"] == pytest.approx(0.0, abs=0.3)

    def test_the_rule_of_thumb_is_applied_the_way_a_runner_reads_it(self):
        """~2 s per mile per pound is 2 / 1.609 / 0.4536 = 2.74 s per km per kg; this
        module rounds to 2.7. Losing weight must come out negative — faster — and the
        race figure must be the per-km one over 21.0975 km.

        It is a rule of thumb and is labelled as one everywhere it is shown. The test
        pins the arithmetic, not the physiology.
        """
        assert B.SECONDS_PER_KM_PER_KG == 2.7
        series = self.steady_loss(0.35)
        result = B.race_projection(series, HALF, today=date(2026, 9, 22))
        assert result["rule_of_thumb_s_per_km"] < 0
        expected = result["change_kg"] * 2.7 * 21.0975
        assert result["rule_of_thumb_race_s"] == pytest.approx(expected, abs=1)

    def test_too_few_readings_is_no_projection_rather_than_a_bad_one(self):
        """A line through three points is a straight face on a coin toss."""
        rows = [
            {"day": "2026-09-0%d" % d, "weight_kg": 80.0, "body_fat_pct": None, "bmi": None}
            for d in (1, 5, 9)
        ]
        assert B.race_projection(B.composition(rows), HALF, today=date(2026, 9, 22)) is None

    def test_a_short_span_of_many_readings_is_also_refused(self):
        """Ten readings in a week says nothing about January."""
        rows = [
            {"day": (date(2026, 9, 16) + timedelta(days=i)).isoformat(),
             "weight_kg": 80.0, "body_fat_pct": None, "bmi": None}
            for i in range(7)
        ]
        assert B.race_projection(B.composition(rows), HALF, today=date(2026, 9, 22)) is None

    def test_no_race_in_the_calendar_is_no_projection(self):
        """There is nothing to carry the trend forward to."""
        assert B.race_projection(self.steady_loss(0.35), None, today=date(2026, 9, 22)) is None

    def test_nothing_weighed_is_no_projection(self):
        assert B.race_projection(B.composition([]), HALF, today=date(2026, 9, 22)) is None


class TestAgainstLoad:
    def test_only_days_that_have_both(self):
        """A line drawn across a period where one series does not exist is a claim
        about data that was never collected."""
        series = B.composition(
            [{"day": "2026-01-0%d" % d, "weight_kg": 76.0, "body_fat_pct": None, "bmi": None}
             for d in (1, 3)]
        )
        curve = [
            {"day": "2025-12-31", "ctl": 40.0},
            {"day": "2026-01-01", "ctl": 41.0},
            {"day": "2026-01-02", "ctl": 42.0},
            {"day": "2026-01-09", "ctl": 43.0},
        ]
        out = B.against_load(series, curve)
        assert [p["day"] for p in out] == ["2026-01-01", "2026-01-02"]
        assert out[0] == {"day": "2026-01-01", "trend_kg": 76.0, "ctl": 41.0}


class TestPowerToWeight:
    def series(self):
        return B.composition(
            [{"day": "2026-01-01", "weight_kg": 80.0, "body_fat_pct": None, "bmi": None},
             {"day": "2026-01-02", "weight_kg": 80.0, "body_fat_pct": None, "bmi": None}]
        )

    def test_watts_over_the_trend(self):
        """200 W at a trend of 80.0 kg is 2.5 W/kg."""
        rides = [{"activity_id": "a1", "day": "2026-01-01", "avg_power_w": 200.0,
                  "duration_s": 3600}]
        assert B.power_to_weight(rides, self.series())[0]["watts_per_kg"] == 2.5

    def test_a_ride_with_no_power_meter_is_left_out(self):
        rides = [{"activity_id": "a1", "day": "2026-01-01", "avg_power_w": None,
                  "duration_s": 3600}]
        assert B.power_to_weight(rides, self.series()) == []

    def test_a_commute_is_left_out(self):
        """Ten minutes of average power is a measurement of traffic lights."""
        rides = [{"activity_id": "a1", "day": "2026-01-01", "avg_power_w": 200.0,
                  "duration_s": 600}]
        assert B.power_to_weight(rides, self.series()) == []

    def test_a_ride_on_a_day_with_no_trend_is_left_out(self):
        rides = [{"activity_id": "a1", "day": "2025-06-01", "avg_power_w": 200.0,
                  "duration_s": 3600}]
        assert B.power_to_weight(rides, self.series()) == []


class TestSpeedVsWeight:
    def build(self, weeks: int, speed_growth: float, weight_loss: float):
        rows, runs = [], []
        start = date(2026, 1, 5)  # a Monday
        for week in range(weeks):
            for day_offset in (0, 3):
                day = (start + timedelta(days=week * 7 + day_offset)).isoformat()
                rows.append({"day": day, "weight_kg": 80.0 - weight_loss * week,
                             "body_fat_pct": None, "bmi": None})
                runs.append({"day": day, "avg_speed_mps": 3.0 * (1 + speed_growth) ** week})
        return runs, B.composition(rows)

    def test_both_series_start_at_one_hundred(self):
        runs, series = self.build(4, 0.01, 0.2)
        points = B.speed_vs_weight(runs, series)
        assert points[0]["speed_index"] == 100.0 and points[0]["weight_index"] == 100.0

    def test_speed_up_and_weight_down_read_in_opposite_directions(self):
        """The comparison the chart exists for, and the reason it is two indices rather
        than a speed per kilogram: the reader decides whether 4 % of speed is explained
        by 2 % of weight, and the code does not pretend to know."""
        runs, series = self.build(9, 0.01, 0.2)
        last = B.speed_vs_weight(runs, series)[-1]
        assert last["speed_index"] > 105
        assert last["weight_index"] < 99

    def test_one_week_is_not_a_comparison(self):
        runs, series = self.build(1, 0.01, 0.2)
        assert B.speed_vs_weight(runs, series) == []

    def test_no_runs_is_empty(self):
        _runs, series = self.build(4, 0.0, 0.0)
        assert B.speed_vs_weight([], series) == []


class TestTheWholeReport:
    def test_an_empty_database_says_so_rather_than_drawing_nothing(self, store):
        """The Health section hides itself on this, which is why it is a flag and not
        an empty list the UI has to interpret."""
        result = B.compute_body(store, days=180, today=date(2026, 9, 22))
        assert result["has_data"] is False
        assert result["latest"] is None and result["projection"] is None
        assert result["series"]["days"] == []
        assert result["consistency"]["readings"] == 0

    def test_it_reports_everything_on_seeded_data(self, seeded_store):
        result = B.compute_body(seeded_store, days=540, today=date(2026, 9, 22))
        assert result["has_data"] is True
        assert result["latest"]["trend_kg"] is not None
        assert result["consistency"]["readings"] > 50
        assert len(result["against_load"]) > 100
        # Fat off, lean on: the seeded block is a real training block (T22).
        assert result["latest"]["fat_change_kg"] < 0
        assert result["latest"]["lean_change_kg"] > 0

    def test_the_window_bounds_the_charts_and_not_the_projection(self, seeded_store):
        """Narrowing the view must not be able to move race day or refit the line."""
        # The projection needs a race, and the race is the calendar's now (T57).
        seeded_store.conn.execute(
            "INSERT INTO plan_sources (kind, url, label, enabled) "
            "VALUES ('ics', 'https://example.test/b.ics', 'Test', 1)"
        )
        sid = seeded_store.conn.execute("SELECT id FROM plan_sources").fetchone()[0]
        seeded_store.conn.execute(
            "INSERT INTO plan_sessions (source_id, uid, recurrence_id, day, start_local, "
            "sport, kind, planned_min_m, planned_max_m, title, parse_status) VALUES "
            "(?, 'r', '', '2027-01-15', '2027-01-15T07:35:00', 'running', 'race', "
            "21097.5, 21097.5, 'RACE: Half', 'ok')",
            (sid,),
        )
        seeded_store.conn.commit()

        wide = B.compute_body(seeded_store, days=540, today=date(2026, 9, 22))
        narrow = B.compute_body(seeded_store, days=120, today=date(2026, 9, 22))
        assert len(narrow["series"]["days"]) < len(wide["series"]["days"])
        assert narrow["projection"]["projected_kg"] == wide["projection"]["projected_kg"]


@pytest.fixture(scope="module")
def seeded_store(tmp_path_factory):
    import os

    from odeda.config import load_settings
    from odeda.db.store import Store
    from odeda.seed import synthetic

    tmp = tmp_path_factory.mktemp("bodyseed")
    old = os.environ.get("GA_DB"), os.environ.get("GA_DATA_DIR")
    os.environ["GA_DB"] = str(tmp / "body.db")
    os.environ["GA_DATA_DIR"] = str(tmp)
    try:
        st = Store.open(load_settings())
        synthetic.seed_database(st, end=date(2026, 9, 22), months=18, reset=True)
        yield st
        st.close()
    finally:
        for name, value in zip(("GA_DB", "GA_DATA_DIR"), old):
            if value is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = value
