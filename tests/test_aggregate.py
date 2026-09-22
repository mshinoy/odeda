"""Aggregate analytics: totals, distributions, patterns, streaks, records.

Every expected number here is worked out in a comment first. The point of this tab is
to answer "what is my average pace over 300 runs"; a plausible-looking wrong answer is
worse than no answer.
"""

from __future__ import annotations

from datetime import date

import pytest

from garmin_analytics.analytics import aggregate as A
from garmin_analytics.edits import gear as G
from garmin_analytics.edits import overrides as ov


def _act(store, activity_id, day, *, activity_type="running", distance_m=10_000.0,
         moving_time_s=3_000.0, avg_hr=150.0, hour=6, elevation=10.0, calories=600.0):
    store.upsert("activities", ["activity_id"], {
        "activity_id": activity_id,
        "day": day,
        "start_time_local": f"{day}T{hour:02d}:30:00",
        "activity_type": activity_type,
        "activity_name": "Session",
        "distance_m": distance_m,
        "duration_s": moving_time_s,
        "moving_time_s": moving_time_s,
        "avg_hr": avg_hr,
        "avg_speed_mps": (distance_m / moving_time_s) if moving_time_s else None,
        "elevation_gain_m": elevation,
        "calories": calories,
        "trimp": 60.0,
    })
    store.conn.commit()
    return activity_id


class TestTotals:
    def test_totals_add_up(self, store):
        # Three 10 km runs of 50 minutes each = 30 km, 9 000 s, 30 m climb.
        for i, day in enumerate(["2026-01-01", "2026-01-08", "2026-01-15"]):
            _act(store, f"a{i}", day)
        t = A.totals(store)
        assert t["activities"] == 3
        assert t["distance_km"] == pytest.approx(30.0)
        assert t["moving_time_h"] == pytest.approx(2.5)
        assert t["elevation_gain_m"] == pytest.approx(30.0)

    def test_average_pace_is_distance_weighted_not_a_mean_of_paces(self, store):
        """A 1 km jog and a 30 km run are not equally informative about your pace.

        Distances 1 000 m in 400 s (6:40/km) and 30 000 m in 9 000 s (5:00/km).
        Mean of the two paces would be 5:50/km.
        Total distance / total time = 31 000 / 9 400 = 3.2979 m/s = 5:03/km.
        """
        _act(store, "short", "2026-01-01", distance_m=1_000.0, moving_time_s=400.0)
        _act(store, "long", "2026-01-02", distance_m=30_000.0, moving_time_s=9_000.0)
        t = A.totals(store)
        assert t["avg_speed_mps"] == pytest.approx(31_000 / 9_400, rel=1e-4)
        assert t["avg_pace_s_per_km"] == pytest.approx(9_400 / 31.0, rel=1e-4)
        assert t["avg_pace"] == "5:03/km"

    def test_span_and_per_week_rates(self, store):
        # 2026-01-01 to 2026-12-31 is 364 days = 0.9966 years.
        _act(store, "a", "2026-01-01")
        _act(store, "b", "2026-12-31")
        t = A.totals(store)
        assert t["span_days"] == 365
        assert t["span_years"] == pytest.approx(0.9966, abs=0.01)
        # Reported to 2 dp, so compare with half-a-last-digit tolerance.
        assert t["activities_per_week"] == pytest.approx(2 / (0.9966 * 52.18), abs=0.005)

    def test_empty_result_does_not_explode(self, store):
        t = A.totals(store)
        assert t["activities"] == 0
        assert t["avg_pace"] is None
        assert "span_days" not in t

    def test_excluded_activities_are_invisible_to_every_total(self, store):
        _act(store, "real", "2026-01-01")
        _act(store, "in_the_car", "2026-01-02", distance_m=90_000.0)
        assert A.totals(store)["distance_km"] == pytest.approx(100.0)
        ov.set_override(store, "in_the_car", "excluded_from_stats", True)
        t = A.totals(store)
        assert t["activities"] == 1
        assert t["distance_km"] == pytest.approx(10.0)

    def test_a_retyped_activity_counts_under_its_new_type(self, store):
        """The user fixes a run the watch called a walk; the totals must follow."""
        _act(store, "a", "2026-01-01", activity_type="walking")
        assert A.totals(store, activity_type="running")["activities"] == 0
        ov.set_override(store, "a", "activity_type", "running")
        assert A.totals(store, activity_type="running")["activities"] == 1


class TestFilters:
    @pytest.fixture
    def mixed(self, store):
        _act(store, "r1", "2026-01-01", activity_type="running")
        _act(store, "r2", "2026-06-01", activity_type="running")
        _act(store, "c1", "2026-03-01", activity_type="cycling", distance_m=40_000.0)
        return store

    def test_type_filter(self, mixed, store):
        assert A.totals(store, activity_type="running")["activities"] == 2
        assert A.totals(store, activity_type="cycling")["activities"] == 1

    def test_date_range_filter(self, mixed, store):
        assert A.totals(store, start="2026-02-01", end="2026-12-31")["activities"] == 2

    def test_gear_filter(self, mixed, store):
        shoes = G.create(store, kind="shoe", nickname="x")
        G.assign(store, "r1", shoes["gear_id"])
        assert A.totals(store, gear_id=shoes["gear_id"])["activities"] == 1

    def test_by_type_ignores_the_type_filter(self, mixed, store):
        """by_type answers "how much of each"; filtering to one type makes it useless."""
        rows = A.by_type(store, activity_type="running")
        assert {r["activity_type"] for r in rows} == {"running", "cycling"}


class TestPeriods:
    def test_by_year(self, store):
        _act(store, "a", "2024-05-01")
        _act(store, "b", "2025-05-01")
        _act(store, "c", "2025-06-01")
        rows = A.by_period(store, "year")
        assert [r["period"] for r in rows] == ["2024", "2025"]
        assert [r["activities"] for r in rows] == [1, 2]

    def test_by_month(self, store):
        _act(store, "a", "2026-01-05")
        _act(store, "b", "2026-01-20")
        _act(store, "c", "2026-02-02")
        rows = A.by_period(store, "month")
        assert [r["period"] for r in rows] == ["2026-01", "2026-02"]

    def test_unknown_period_is_rejected(self, store):
        with pytest.raises(ValueError):
            A.by_period(store, "fortnight")

    def test_year_over_year_change_direction(self, store):
        # 2025: 10 km at 5:00/km. 2026: 20 km at 4:00/km.
        _act(store, "a", "2025-05-01", distance_m=10_000.0, moving_time_s=3_000.0)
        _act(store, "b", "2026-05-01", distance_m=20_000.0, moving_time_s=4_800.0)
        years = A.year_over_year(store)["years"]
        assert years[0]["changes"] == {}
        ch = years[1]["changes"]
        assert ch["distance_km"]["pct"] == pytest.approx(100.0)
        assert ch["distance_km"]["better"] is True
        # Pace went from 300 s/km to 240 s/km: lower is better.
        assert ch["avg_pace_s_per_km"]["pct"] == pytest.approx(-20.0)
        assert ch["avg_pace_s_per_km"]["better"] is True


class TestDistributions:
    def test_pace_histogram_buckets_by_15_seconds(self, store):
        # 10 km in 3 000 s = 300 s/km, which falls in the [300, 315) bucket.
        _act(store, "a", "2026-01-01", distance_m=10_000.0, moving_time_s=3_000.0)
        buckets = A.distributions(store)["pace"]
        assert len(buckets) == 1
        assert buckets[0]["lo"] == 300.0
        assert buckets[0]["hi"] == 315.0
        assert buckets[0]["count"] == 1

    def test_absurd_paces_are_dropped_from_the_histogram(self, store):
        """A 30-second kilometre is a bad GPS fix, not a world record."""
        _act(store, "car", "2026-01-01", distance_m=100_000.0, moving_time_s=3_000.0)
        assert A.distributions(store)["pace"] == []

    def test_hr_zone_split_sums_to_100_percent(self, store):
        _act(store, "a", "2026-01-01")
        for zone, secs in ((1, 300.0), (2, 900.0), (3, 1200.0), (4, 400.0), (5, 200.0)):
            store.upsert("activity_hr_zones", ["activity_id", "zone"],
                         {"activity_id": "a", "zone": zone, "seconds": secs})
        store.conn.commit()
        zones = A.distributions(store)["hr_zones"]
        assert sum(z["pct"] for z in zones) == pytest.approx(100.0, abs=0.2)
        # 1200 of 3000 seconds in zone 3 = 40 %.
        assert next(z for z in zones if z["zone"] == 3)["pct"] == pytest.approx(40.0)

    def test_histograms_of_an_empty_set_are_empty(self, store):
        d = A.distributions(store)
        assert d["pace"] == [] and d["distance_km"] == [] and d["hr_zones"] == []


class TestPatterns:
    def test_day_of_week_counts(self, store):
        # 2026-01-05 is a Monday; 2026-01-10 and 2026-01-17 are Saturdays.
        assert date(2026, 1, 5).weekday() == 0
        _act(store, "mon", "2026-01-05")
        _act(store, "sat1", "2026-01-10")
        _act(store, "sat2", "2026-01-17")
        p = A.patterns(store)
        assert p["day_of_week"][0]["count"] == 1        # Monday
        assert p["day_of_week"][5]["count"] == 2        # Saturday
        assert p["busiest_day"] == "Sat"

    def test_hour_of_day_comes_from_the_local_start_time(self, store):
        _act(store, "early", "2026-01-05", hour=6)
        _act(store, "late", "2026-01-06", hour=19)
        p = A.patterns(store)
        assert p["hour_of_day"][6]["count"] == 1
        assert p["hour_of_day"][19]["count"] == 1

    def test_dow_hour_matrix_shape(self, store):
        _act(store, "a", "2026-01-05", hour=6)
        m = A.patterns(store)["dow_hour_matrix"]
        assert len(m) == 7 and all(len(r) == 24 for r in m)
        assert m[0][6] == 1

    def test_seasonality_by_month(self, store):
        _act(store, "a", "2026-01-05")
        _act(store, "b", "2026-01-20")
        _act(store, "c", "2026-07-01")
        months = A.patterns(store)["month_of_year"]
        assert months[0]["count"] == 2      # January
        assert months[6]["count"] == 1      # July

    def test_patterns_of_nothing_are_zeroes_not_an_error(self, store):
        p = A.patterns(store)
        assert p["total"] == 0
        assert p["busiest_day"] is None


class TestStreaks:
    def test_longest_streak_of_consecutive_days(self, store):
        for i, day in enumerate(["2026-01-01", "2026-01-02", "2026-01-03",
                                 "2026-01-06", "2026-01-07"]):
            _act(store, f"a{i}", day)
        s = A.streaks(store)
        assert s["longest"] == 3
        assert s["longest_end"] == "2026-01-03"
        assert s["active_days"] == 5
        assert s["span_days"] == 7
        assert s["rest_days"] == 2

    def test_two_activities_in_one_day_are_one_active_day(self, store):
        _act(store, "am", "2026-01-01", hour=6)
        _act(store, "pm", "2026-01-01", hour=18)
        assert A.streaks(store)["active_days"] == 1

    def test_an_old_streak_is_not_a_current_streak(self, store):
        for i, day in enumerate(["2020-01-01", "2020-01-02", "2020-01-03"]):
            _act(store, f"a{i}", day)
        assert A.streaks(store)["current"] == 0

    def test_biggest_week_by_distance(self, store):
        _act(store, "a", "2026-01-05", distance_m=5_000.0)
        _act(store, "b", "2026-01-12", distance_m=40_000.0)
        _act(store, "c", "2026-01-13", distance_m=20_000.0)
        week = A.streaks(store)["biggest_week"]
        assert week["distance_km"] == pytest.approx(60.0)
        assert week["activities"] == 2

    def test_streaks_of_nothing(self, store):
        s = A.streaks(store)
        assert s["current"] == 0 and s["longest"] == 0 and s["biggest_week"] is None


class TestRecords:
    def test_best_effort_picks_the_fastest(self, store):
        _act(store, "slow", "2026-01-01")
        _act(store, "fast", "2026-02-01")
        for aid, secs in (("slow", 1400.0), ("fast", 1300.0)):
            store.upsert("best_efforts", ["activity_id", "distance_m"], {
                "activity_id": aid, "distance_m": 5000.0, "seconds": secs,
                "day": "2026-01-01"})
        store.conn.commit()
        best = A.records(store)["best_efforts"]
        assert len(best) == 1
        assert best[0]["activity_id"] == "fast"
        assert best[0]["time"] == "21:40"
        # 1300 s over 5 km is 260 s/km = 4:20/km.
        assert best[0]["pace"] == "4:20/km"

    def test_excluded_activity_cannot_hold_a_record(self, store):
        _act(store, "real", "2026-01-01")
        _act(store, "bogus", "2026-02-01")
        for aid, secs in (("real", 1400.0), ("bogus", 600.0)):
            store.upsert("best_efforts", ["activity_id", "distance_m"], {
                "activity_id": aid, "distance_m": 5000.0, "seconds": secs,
                "day": "2026-01-01"})
        store.conn.commit()
        ov.set_override(store, "bogus", "excluded_from_stats", True)
        assert A.records(store)["best_efforts"][0]["activity_id"] == "real"

    def test_extremes(self, store):
        _act(store, "short", "2026-01-01", distance_m=5_000.0, elevation=5.0)
        _act(store, "long", "2026-02-01", distance_m=32_000.0, moving_time_s=11_000.0,
             elevation=450.0)
        extremes = {e["key"]: e for e in A.records(store)["extremes"]}
        assert extremes["longest_distance"]["activity_id"] == "long"
        assert extremes["longest_distance"]["display"] == "32.00 km"
        assert extremes["most_elevation"]["activity_id"] == "long"
        assert extremes["most_elevation"]["display"] == "450 m"

    def test_fastest_average_is_formatted_as_a_pace_once(self, store):
        _act(store, "a", "2026-01-01", distance_m=10_000.0, moving_time_s=2_400.0)
        fastest = next(e for e in A.records(store)["extremes"]
                       if e["key"] == "fastest_average")
        # 10 000 m in 2 400 s = 4.1667 m/s = 240 s/km = 4:00/km.
        assert fastest["display"] == "4:00/km"
        assert fastest["display"].count("/km") == 1


class TestWholeTab:
    def test_compute_aggregate_returns_every_section(self, seeded_store):
        out = A.compute_aggregate(seeded_store, activity_type="running")
        for key in ("totals", "by_type", "by_year", "by_month", "year_over_year",
                    "distributions", "patterns", "streaks", "records"):
            assert key in out, key
        assert out["totals"]["activities"] > 0

    def test_available_filters(self, seeded_store):
        f = A.available_filters(seeded_store)
        assert any(t["value"] == "running" for t in f["types"])
        assert f["range"]["first_day"] < f["range"]["last_day"]
