"""Rollups, streaks and consistency."""

from __future__ import annotations

from datetime import date

import pytest

from garmin_analytics.analytics import reports as Rep


class TestIsoWeek:
    def test_week_key_format(self):
        assert Rep.iso_week_key("2026-09-22") == "2026-W39"

    def test_new_year_boundary_uses_the_iso_year(self):
        """2027-01-01 is a Friday in ISO week 53 of 2026 — SQLite's %Y-%W gets this wrong."""
        assert Rep.iso_week_key("2027-01-01") == "2026-W53"

    def test_week_start_is_monday(self):
        assert Rep.week_start("2026-09-22") == "2026-09-21"   # Tuesday → Monday
        assert Rep.week_start("2026-09-21") == "2026-09-21"   # Monday → itself


class TestStreaks:
    def test_longest_run_of_consecutive_days(self):
        days = ["2026-01-01", "2026-01-02", "2026-01-03",
                "2026-01-05",
                "2026-01-08", "2026-01-09", "2026-01-10", "2026-01-11"]
        out = Rep.longest_streak(days)
        assert out == {"length": 4, "start": "2026-01-08", "end": "2026-01-11"}

    def test_single_day(self):
        assert Rep.longest_streak(["2026-01-01"])["length"] == 1

    def test_empty(self):
        assert Rep.longest_streak([]) == {"length": 0, "start": None, "end": None}

    def test_duplicates_do_not_inflate_the_streak(self):
        assert Rep.longest_streak(["2026-01-01", "2026-01-01", "2026-01-02"])["length"] == 2

    def test_unsorted_input(self):
        assert Rep.longest_streak(["2026-01-03", "2026-01-01", "2026-01-02"])["length"] == 3

    def test_current_streak_counts_back_from_today(self):
        days = ["2026-01-08", "2026-01-09", "2026-01-10"]
        assert Rep.current_streak(days, today=date(2026, 1, 10)) == 3

    def test_current_streak_tolerates_today_not_being_over(self):
        """Nothing logged yet today does not break yesterday's streak."""
        days = ["2026-01-08", "2026-01-09", "2026-01-10"]
        assert Rep.current_streak(days, today=date(2026, 1, 11)) == 3

    def test_current_streak_is_zero_after_a_gap(self):
        days = ["2026-01-08", "2026-01-09"]
        assert Rep.current_streak(days, today=date(2026, 1, 15)) == 0


class TestWeekdayConsistency:
    def test_counts_and_percentages(self):
        # 2026-01-05 is a Monday.
        days = ["2026-01-05", "2026-01-12", "2026-01-19", "2026-01-06"]
        out = {r["weekday"]: r for r in Rep.weekday_consistency(days)}
        assert out["Mon"]["count"] == 3
        assert out["Tue"]["count"] == 1
        assert out["Sun"]["count"] == 0
        assert out["Mon"]["pct"] == pytest.approx(75.0)

    def test_always_returns_all_seven_days(self):
        assert len(Rep.weekday_consistency([])) == 7

    def test_percentages_sum_to_a_hundred(self):
        days = [f"2026-01-{d:02d}" for d in range(1, 15)]
        assert sum(r["pct"] for r in Rep.weekday_consistency(days)) == pytest.approx(100.0, abs=0.2)


class TestPctDelta:
    def test_basic(self):
        assert Rep.pct_delta(110, 100) == pytest.approx(10.0)
        assert Rep.pct_delta(90, 100) == pytest.approx(-10.0)

    @pytest.mark.parametrize("now, prev", [(None, 100), (100, None), (100, 0)])
    def test_undefined_cases(self, now, prev):
        assert Rep.pct_delta(now, prev) is None


class TestAgainstSeededStore:
    def test_weekly_rollup_separates_running_from_all_sport(self, seeded_store):
        weeks = Rep.weekly_report(seeded_store)
        assert weeks
        for w in weeks:
            assert w["run_km"] <= w["km"] + 1e-9
            assert w["runs"] <= w["sessions"]

    def test_weekly_rollup_is_chronological_and_capped(self, seeded_store):
        weeks = Rep.weekly_report(seeded_store, limit=4)
        assert len(weeks) <= 4
        assert [w["week"] for w in weeks] == sorted(w["week"] for w in weeks)

    def test_monthly_rollup_shape(self, seeded_store):
        months = Rep.monthly_report(seeded_store)
        assert months
        for m in months:
            assert len(m["month"]) == 7
            assert m["run_km"] <= m["km"] + 1e-9

    def test_totals_are_consistent_with_the_tables(self, seeded_store):
        out = Rep.compute_reports(seeded_store)
        monthly_km = sum(m["run_km"] for m in out["monthly"])
        assert monthly_km == pytest.approx(out["totals"]["total_run_km"], abs=0.5)

    def test_active_days_never_exceed_tracked_days(self, seeded_store):
        totals = Rep.compute_reports(seeded_store)["totals"]
        assert totals["active_days"] <= totals["tracked_days"]

    def test_empty_store_returns_empty_rollups(self, store):
        out = Rep.compute_reports(store)
        assert out["weekly"] == [] and out["monthly"] == []
        assert out["totals"]["activities"] == 0
        assert out["streaks"]["longest_active"]["length"] == 0
