"""Race-morning form forecast and the finish-time range."""

from __future__ import annotations

from datetime import date

import pytest

from conftest import add_calendar_race
from garmin_analytics.analytics import forecast as F
from garmin_analytics.analytics import load as load_mod
from garmin_analytics.analytics import plan as plan_mod

TODAY = date(2026, 12, 1)
RACE = date(2027, 1, 15)


def planned(day, metres, sport="running", optional=False, verdict="upcoming"):
    return plan_mod.Judged(
        planned=plan_mod.PlannedDay(
            day=day, sport=sport, kind="easy", min_m=metres, max_m=metres,
            optional=optional, title="run",
        ),
        verdict=verdict,
    )


class TestVerdict:
    @pytest.mark.parametrize(
        "tsb,level,phrase",
        [(-15, "warning", "fatigue"), (0, "good", "neutral"), (12, "good", "fresh window"),
         (30, "warning", "very fresh")],
    )
    def test_bands(self, tsb, level, phrase):
        out = F.form_verdict(tsb)
        assert out["level"] == level
        assert phrase in out["text"]

    def test_fresh_because_fitness_is_falling_is_not_good_news(self):
        out = F.form_verdict(8, ctl_now=40, ctl_race=25)
        assert out["level"] == "warning"
        assert "fitness falls from 40 to 25" in out["text"]

    def test_a_held_or_rising_fitness_leaves_the_form_verdict_alone(self):
        assert F.form_verdict(8, ctl_now=40, ctl_race=38)["level"] == "good"

    def test_a_cold_start_ctl_is_not_a_fall(self):
        assert F.form_verdict(8, ctl_now=10, ctl_race=2)["level"] == "good"


class TestPlannedLoads:
    def test_prices_kilometres_in_the_owners_load(self):
        out = F.planned_loads([planned("2026-12-02", 10000)], 7.0, TODAY, RACE)
        assert out == {"2026-12-02": pytest.approx(70.0)}

    def test_leaves_out_what_is_not_future_running(self):
        judged = [
            planned("2026-12-02", 10000, sport="strength"),
            planned("2026-12-03", 10000, optional=True),
            planned("2026-12-04", 10000, verdict="done"),
            planned("2026-11-30", 10000),  # before today
            planned("2027-01-15", 21097),  # the race itself
        ]
        assert F.planned_loads(judged, 7.0, TODAY, RACE) == {}

    def test_a_scale_models_adherence(self):
        out = F.planned_loads([planned("2026-12-02", 10000)], 7.0, TODAY, RACE, scale=0.5)
        assert out["2026-12-02"] == pytest.approx(35.0)


class TestProjectForm:
    def test_rest_until_race_lowers_fatigue_faster_than_fitness(self):
        curve = F.project_form({"2026-11-20": 100.0}, {}, TODAY, date(2027, 1, 14))
        today_tsb = next(r for r in curve if r["day"] == TODAY.isoformat())["tsb"]
        assert curve[-1]["day"] == "2027-01-14"
        assert curve[-1]["tsb"] > today_tsb

    def test_planned_load_is_added_to_the_days_actual_load(self):
        base = F.project_form({"2026-12-01": 50.0}, {}, TODAY, RACE)
        more = F.project_form({"2026-12-01": 50.0}, {"2026-12-01": 50.0}, TODAY, RACE)
        assert more[-1]["ctl"] > base[-1]["ctl"]


class TestFactors:
    def test_gaining_fitness_is_faster_and_capped(self):
        assert F.fitness_factor(40, 44) == pytest.approx(0.99)
        assert F.fitness_factor(40, 400) == pytest.approx(1 - F.FITNESS_CAP)
        assert F.fitness_factor(40, 10) == pytest.approx(1 + F.FITNESS_CAP)

    def test_a_cold_start_ctl_adjusts_nothing(self):
        assert F.fitness_factor(5, 50) == 1.0
        assert F.fitness_factor(None, 50) == 1.0

    def test_form(self):
        assert F.form_factor(-20) == F.FORM_FATIGUED_FACTOR
        assert F.form_factor(10) == F.FORM_FRESH_FACTOR
        assert F.form_factor(0) == 1.0
        assert F.form_factor(None) == 1.0


class TestRange:
    def effort(self, d, s):
        return {"distance_m": d, "seconds": s, "day": "2026-11-01", "label": f"{d}"}

    def test_spread_between_efforts_is_the_range(self):
        out = F.project_range(
            [self.effort(5000, 1500), self.effort(10000, 3200)], 21097.5
        )
        assert out["fast"] < out["central"] < out["slow"]

    def test_central_leans_on_the_longer_effort(self):
        a = self.effort(5000, 1500)
        b = self.effort(10000, 3200)
        out = F.project_range([a, b], 21097.5)
        mean = (
            F.perf.riegel(1500, 5000, 21097.5) + F.perf.riegel(3200, 10000, 21097.5)
        ) / 2
        # The 10 k projection is the slower one, so weighting it more lifts the centre.
        assert out["central"] > mean

    def test_one_effort_is_given_the_exponent_band(self):
        out = F.project_range([self.effort(10000, 3000)], 21097.5)
        assert out["widened"]
        assert out["fast"] < out["central"] < out["slow"]

    def test_agreeing_efforts_still_get_the_exponent_band(self):
        """A range of two efforts that happen to agree is not a certain race."""
        t5 = F.perf.riegel(3000, 10000, 21097.5) / (21097.5 / 5000) ** 1.06
        out = F.project_range([self.effort(5000, t5), self.effort(10000, 3000)], 21097.5)
        longest = F.perf.riegel(3000, 10000, 21097.5, F.EXPONENT_BAND[1])
        assert out["slow"] == pytest.approx(longest)
        assert out["widened"]

    def test_short_efforts_are_not_used_when_a_longer_one_exists(self):
        bests = [self.effort(1000, 200), self.effort(10000, 3000)]
        assert [e["distance_m"] for e in F._usable_efforts(bests, 21097.5)] == [10000]

    def test_falls_back_to_the_longest_short_effort(self):
        bests = [self.effort(1000, 200), self.effort(1609.34, 330)]
        assert [e["distance_m"] for e in F._usable_efforts(bests, 21097.5)] == [1609.34]


def _runs(store, start_day, count, metres=8000, load=56.0):
    from datetime import timedelta

    for i in range(count):
        day = (date.fromisoformat(start_day) + timedelta(days=i)).isoformat()
        store.conn.execute(
            "INSERT INTO activities (activity_id, day, start_time_local, activity_type, "
            "distance_m, duration_s, trimp) VALUES (?, ?, ?, 'running', ?, 2700, ?)",
            (f"r-{day}", day, f"{day}T06:00:00", metres, load),
        )
    store.conn.commit()


def _plan_run(store, day, metres):
    sid = store.conn.execute("SELECT id FROM plan_sources ORDER BY id LIMIT 1").fetchone()[0]
    store.conn.execute(
        "INSERT INTO plan_sessions (source_id, uid, recurrence_id, day, start_local, "
        "sport, kind, planned_min_m, planned_max_m, title, parse_status) "
        "VALUES (?, ?, '', ?, ?, 'running', 'easy', ?, ?, 'Run', 'ok')",
        (sid, f"p-{day}", day, f"{day}T06:00:00", metres, metres),
    )
    store.conn.commit()


class TestKmDone:
    def test_is_run_km_over_planned_km_before_today(self, store):
        add_calendar_race(store)
        _runs(store, "2026-11-10", 5, metres=4000, load=30.0)  # 20 km run
        for day in ("2026-11-12", "2026-11-20"):
            _plan_run(store, day, 10000)  # 20 km planned in the window
        judged, _ = plan_mod.judge_all(store, TODAY)
        assert F.recent_km_done_pct(store, judged, TODAY) == pytest.approx(100.0)

    def test_none_when_nothing_was_planned(self, store):
        assert F.recent_km_done_pct(store, [], TODAY) is None

    def test_a_third_of_the_plan_scales_what_remains(self, store):
        add_calendar_race(store)
        _runs(store, "2026-11-10", 1, metres=8000)  # 8 km run
        _plan_run(store, "2026-11-12", 24000)  # 24 km asked for
        _plan_run(store, "2026-12-20", 10000)
        out = F.compute_forecast(store, TODAY)["form"]
        assert out["km_done_pct"] == pytest.approx(33.3, abs=0.1)
        assert out["basis"] == "followed"
        morning = out["race_morning"]
        # Doing a third of the plan leaves less fitness than doing all of it.
        assert morning["ctl_followed"] < morning["ctl"]


class TestStoreBacked:
    def test_no_race_is_an_empty_forecast(self, store):
        out = F.compute_forecast(store, TODAY)
        assert out["race"] is None and out["form"] is None and out["time"] is None

    def test_no_running_history_means_no_form_forecast(self, store):
        add_calendar_race(store)
        out = F.compute_forecast(store, TODAY)
        assert out["race"] is not None
        assert out["form"] is None

    def test_a_taper_reaches_race_morning_fresher_than_today(self, store):
        add_calendar_race(store)
        _runs(store, "2026-10-01", 60)  # a steady base to today
        for i, day in enumerate(("2026-12-20", "2027-01-05", "2027-01-12")):
            _plan_run(store, day, 6000 - i * 1000)
        out = F.compute_forecast(store, TODAY)
        form = out["form"]
        assert form["days_out"] == 45
        assert form["load_per_km"] == pytest.approx(7.0, abs=0.01)
        assert form["race_morning"]["day"] == "2027-01-14"
        assert form["planned_km_remaining"] == pytest.approx(15.0)
        assert form["curve"][0]["day"] == TODAY.isoformat()
        assert form["race_morning"]["tsb"] > load_mod.compute_load(store)["current"]["tsb"]
        assert form["verdict"]["level"] in ("good", "warning")

    def test_the_time_range_carries_both_the_data_and_the_adjustments(self, store):
        add_calendar_race(store)
        _runs(store, "2026-10-01", 60)
        for day in ("2026-12-20", "2027-01-05"):
            _plan_run(store, day, 8000)
        store.conn.executemany(
            "INSERT INTO best_efforts (activity_id, distance_m, seconds, day) VALUES (?, ?, ?, ?)",
            [("r-2026-11-10", 5000.0, 1500.0, "2026-11-10"),
             ("r-2026-11-12", 10000.0, 3200.0, "2026-11-12")],
        )
        store.conn.commit()
        out = F.compute_forecast(store, TODAY)["time"]
        assert out["raw"]["fast"] < out["raw"]["central"] < out["raw"]["slow"]
        assert out["adjusted"]["central"] != out["raw"]["central"] or out["fitness_pct"] == 0
        assert len(out["sources"]) == 2
        assert out["central_pace_s_per_km"] == pytest.approx(
            out["adjusted"]["central"] / 21.0975, abs=0.2
        )

    def test_race_day_today_has_no_forecast(self, store):
        add_calendar_race(store, day=TODAY.isoformat())
        _runs(store, "2026-10-01", 60)
        assert F.compute_forecast(store, TODAY)["form"] is None


def _plan_long(store, day, metres):
    sid = store.conn.execute("SELECT id FROM plan_sources ORDER BY id LIMIT 1").fetchone()[0]
    store.conn.execute(
        "INSERT INTO plan_sessions (source_id, uid, recurrence_id, day, start_local, "
        "sport, kind, planned_min_m, planned_max_m, title, parse_status) "
        "VALUES (?, ?, '', ?, ?, 'running', 'long', ?, ?, 'Long Run - DBRC', 'ok')",
        (sid, f"long-{day}", day, f"{day}T05:00:00", metres, metres),
    )
    store.conn.commit()


def _run_on(store, day, metres, load=80.0):
    store.conn.execute(
        "INSERT INTO activities (activity_id, day, start_time_local, activity_type, "
        "distance_m, duration_s, trimp) VALUES (?, ?, ?, 'running', ?, 5400, ?)",
        (f"lr-{day}", day, f"{day}T05:00:00", metres, load),
    )
    store.conn.commit()


class TestLongRunNote:
    """The long run is the session that matters most for a half. A miss is easy to shrug
    off, so Today says so, with an honest price on it."""

    def _setup(self, store):
        add_calendar_race(store)
        _runs(store, "2026-09-01", 50)  # a base, ending well before the long runs
        _plan_long(store, "2026-12-11", 16000)  # the next one

    def test_a_short_long_run_is_named_with_what_was_missed(self, store):
        self._setup(store)
        _plan_long(store, "2026-11-27", 15000)
        _run_on(store, "2026-11-27", 11200)
        note = F.compute_forecast(store, TODAY)["long_run"]
        assert note["verdict"] == "short"
        assert note["day"] == "2026-11-27"
        assert note["planned_km"] == 15.0 and note["done_km"] == 11.2
        assert note["shortfall_km"] == pytest.approx(3.8)

    def test_a_missed_one_is_missed_and_the_whole_distance_is_the_shortfall(self, store):
        self._setup(store)
        _plan_long(store, "2026-11-27", 15000)
        note = F.compute_forecast(store, TODAY)["long_run"]
        assert note["verdict"] == "missed"
        assert note["done_km"] == 0.0 and note["shortfall_km"] == 15.0

    def test_a_long_run_that_was_done_says_nothing(self, store):
        self._setup(store)
        _plan_long(store, "2026-11-27", 15000)
        _run_on(store, "2026-11-27", 15200)
        assert F.compute_forecast(store, TODAY)["long_run"] is None

    def test_a_later_one_done_clears_an_earlier_one_missed(self, store):
        self._setup(store)
        _plan_long(store, "2026-11-20", 14000)  # missed
        _plan_long(store, "2026-11-27", 15000)
        _run_on(store, "2026-11-27", 15100)
        assert F.compute_forecast(store, TODAY)["long_run"] is None

    def test_one_older_than_a_fortnight_is_history(self, store):
        self._setup(store)
        _plan_long(store, "2026-11-10", 14000)  # missed, 21 days ago
        assert F.compute_forecast(store, TODAY)["long_run"] is None

    def test_it_names_the_next_long_run(self, store):
        self._setup(store)
        _plan_long(store, "2026-11-27", 15000)
        note = F.compute_forecast(store, TODAY)["long_run"]
        assert note["next_day"] == "2026-12-11" and note["next_km"] == 16.0

    def test_the_cost_is_small_and_a_miss_costs_more_than_a_short(self, store):
        self._setup(store)
        store.conn.executemany(
            "INSERT INTO best_efforts (activity_id, distance_m, seconds, day) VALUES (?, ?, ?, ?)",
            [("r-2026-10-10", 5000.0, 1500.0, "2026-10-10"),
             ("r-2026-10-12", 10000.0, 3200.0, "2026-10-12")],
        )
        store.conn.commit()
        _plan_long(store, "2026-11-27", 15000)
        missed = F.compute_forecast(store, TODAY)["long_run"]["cost_seconds"]
        _run_on(store, "2026-11-27", 11200)
        short = F.compute_forecast(store, TODAY)["long_run"]["cost_seconds"]
        assert 0 < short < missed < 300  # seconds on a half marathon: rough, and modest

    def test_a_run_that_is_not_long_is_not_the_long_run(self, store):
        self._setup(store)
        _plan_run(store, "2026-11-27", 15000)  # an easy run of the same length, missed
        assert F.compute_forecast(store, TODAY)["long_run"] is None

    def test_no_race_means_no_note(self, store):
        assert F.compute_forecast(store, TODAY)["long_run"] is None

    def test_a_range_is_judged_against_its_floor_as_the_week_says(self, store):
        """A 15-16 km long run that came to 11.2 km was short of 15, not of 15.5."""
        self._setup(store)
        sid = store.conn.execute("SELECT id FROM plan_sources ORDER BY id LIMIT 1").fetchone()[0]
        store.conn.execute(
            "INSERT INTO plan_sessions (source_id, uid, recurrence_id, day, start_local, "
            "sport, kind, planned_min_m, planned_max_m, title, parse_status) "
            "VALUES (?, 'range', '', '2026-11-27', '2026-11-27T05:00:00', 'running', 'long', "
            "15000, 16000, 'Long Run', 'ok')",
            (sid,),
        )
        store.conn.commit()
        _run_on(store, "2026-11-27", 11200)
        note = F.compute_forecast(store, TODAY)["long_run"]
        assert note["planned_km"] == 15.0
        assert note["shortfall_km"] == pytest.approx(3.8)
