"""Training-load maths: TRIMP, CTL/ATL/TSB, ramp rate.

Every expected number here is derived on paper in the docstring or comment next to it,
so a failure tells you which step of the formula moved — not just that a number changed.
"""

from __future__ import annotations

import math
from datetime import date, timedelta

import pytest

from garmin_analytics.analytics import load as L


class TestTrimp:
    def test_banister_hand_checked(self):
        """60 min at 150 bpm, rest 50, max 190, male.

        HRr  = (150-50)/(190-50) = 0.714285714…
        TRIMP = 60 × 0.714285714 × 0.64 × e^(1.92 × 0.714285714)
              = 42.857142857 × 0.64 × e^1.371428571
              = 27.428571429 × 3.940850…
              = 108.09535934…
        """
        assert L.trimp(60, 150, 50, 190, "male") == pytest.approx(108.09535934, abs=1e-6)

    def test_female_exponent_is_lower(self):
        """Same bout, k = 1.67 instead of 1.92 → 90.41790987…"""
        female = L.trimp(60, 150, 50, 190, "female")
        assert female == pytest.approx(90.41790987, abs=1e-6)
        assert female < L.trimp(60, 150, 50, 190, "male")

    def test_unknown_sex_falls_back_to_male_exponent(self):
        assert L.trimp(60, 150, 50, 190, "unspecified") == L.trimp(60, 150, 50, 190, "male")

    def test_linear_in_duration(self):
        one = L.trimp(30, 150, 50, 190)
        two = L.trimp(60, 150, 50, 190)
        assert two == pytest.approx(2 * one)

    def test_exponential_in_intensity(self):
        """Doubling HR reserve more than doubles TRIMP — that is the whole point."""
        low = L.trimp(60, 120, 50, 190)    # HRr = 0.5
        high = L.trimp(60, 190, 50, 190)   # HRr = 1.0
        assert high > 2 * low

    @pytest.mark.parametrize(
        "duration, hr",
        [(0, 150), (-10, 150), (60, 50), (60, 40)],
    )
    def test_no_impulse_cases(self, duration, hr):
        """Zero duration, or an average HR at or below resting, is no training impulse."""
        assert L.trimp(duration, hr, 50, 190) == 0.0

    def test_missing_hr_is_zero_not_a_crash(self):
        assert L.trimp(60, None, 50, 190) == 0.0

    def test_degenerate_hr_range(self):
        assert L.trimp(60, 150, 190, 190) == 0.0

    def test_hrr_is_capped_at_one(self):
        """An HR above max (sensor spike) must not blow up the exponential."""
        assert L.trimp(60, 250, 50, 190) == pytest.approx(L.trimp(60, 190, 50, 190))


class TestTrimpFromZones:
    def test_hand_checked_two_zones(self):
        """10 min in zone 2 (HRr 0.65) + 10 min in zone 4 (HRr 0.85), male.

        z2 = 10 × 0.65 × 0.64 × e^(1.92×0.65) = 4.16 × 3.48364… = 14.4919…
        z4 = 10 × 0.85 × 0.64 × e^(1.92×0.85) = 5.44 × 5.11433… = 27.8219…
        total = 42.31148026…
        """
        zones = {2: 600, 4: 600}
        assert L.trimp_from_zones(zones, 50, 190, "male") == pytest.approx(42.31148026, abs=1e-6)

    def test_zone_split_beats_flattened_average_for_intervals(self):
        """20 min split between zone 1 and zone 5 is harder than 20 min at the mean.

        This is the reason the app prefers zone dwell times: averaging HR across an
        interval session throws away the exponential.
        """
        split = L.trimp_from_zones({1: 600, 5: 600}, 50, 190, "male")
        mean_hrr = (L.ZONE_HRR_MIDPOINTS[1] + L.ZONE_HRR_MIDPOINTS[5]) / 2
        flattened = L.trimp(20, 50 + mean_hrr * 140, 50, 190, "male")
        assert split > flattened

    def test_ignores_junk_zones_and_empty_dwell(self):
        assert L.trimp_from_zones({0: 600, 9: 600, 3: 0, 2: None}, 50, 190) == 0.0

    def test_empty_is_zero(self):
        assert L.trimp_from_zones({}, 50, 190) == 0.0


class TestEwma:
    def test_alpha_matches_the_time_constant(self):
        """CTL alpha = 1 − e^(−1/42) = 0.0235283133…, ATL alpha = 0.1331221002…"""
        ctl = L.ewma_series([100], L.CTL_TAU_DAYS)
        atl = L.ewma_series([100], L.ATL_TAU_DAYS)
        assert ctl[0] == pytest.approx(100 * 0.023528313347756735, abs=1e-9)
        assert atl[0] == pytest.approx(100 * 0.1331221002498184, abs=1e-9)

    def test_first_three_ctl_days_hand_checked(self):
        """Constant 100/day from a cold start: 2.35283133, 4.65030452, 6.89372203."""
        out = L.ewma_series([100, 100, 100], L.CTL_TAU_DAYS)
        assert out == pytest.approx([2.3528313348, 4.6503045167, 6.8937220296], abs=1e-9)

    def test_converges_to_the_constant_load(self):
        out = L.ewma_series([100] * 600, L.CTL_TAU_DAYS)
        assert out[-1] == pytest.approx(100, abs=0.01)

    def test_atl_converges_faster_than_ctl(self):
        loads = [100] * 30
        assert L.ewma_series(loads, L.ATL_TAU_DAYS)[-1] > L.ewma_series(loads, L.CTL_TAU_DAYS)[-1]

    def test_rest_days_decay_the_average(self):
        """Zeros must be present, not skipped — decay on rest days is the whole model."""
        built = L.ewma_series([100] * 60, L.ATL_TAU_DAYS)[-1]
        after_rest = L.ewma_series([100] * 60 + [0] * 7, L.ATL_TAU_DAYS)[-1]
        assert after_rest < built * 0.4

    def test_seed_is_respected(self):
        assert L.ewma_series([0], 42, seed=50)[0] == pytest.approx(50 * (1 - 0.023528313347756735))


class TestDensify:
    def test_zero_fills_missing_days(self):
        days, values = L.densify({"2026-01-01": 50, "2026-01-03": 70},
                                 date(2026, 1, 1), date(2026, 1, 4))
        assert days == ["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04"]
        assert values == [50.0, 0.0, 70.0, 0.0]

    def test_single_day_range(self):
        days, values = L.densify({}, date(2026, 1, 1), date(2026, 1, 1))
        assert days == ["2026-01-01"] and values == [0.0]


class TestLoadCurve:
    def test_tsb_is_ctl_minus_atl(self):
        curve = L.load_curve({f"2026-01-{d:02d}": 80 for d in range(1, 29)},
                             date(2026, 1, 1), date(2026, 1, 28))
        for row in curve:
            assert row["tsb"] == pytest.approx(row["ctl"] - row["atl"], abs=0.02)

    def test_tsb_is_negative_while_building(self):
        """Ramping load means ATL outruns CTL — that is what fatigue looks like."""
        curve = L.load_curve({f"2026-01-{d:02d}": 80 for d in range(1, 29)},
                             date(2026, 1, 1), date(2026, 1, 28))
        assert curve[-1]["tsb"] < 0

    def test_tsb_turns_positive_after_a_taper(self):
        loads = {f"2026-01-{d:02d}": 80 for d in range(1, 29)}
        loads.update({f"2026-02-{d:02d}": 0 for d in range(1, 15)})
        curve = L.load_curve(loads, date(2026, 1, 1), date(2026, 2, 14))
        assert curve[-1]["tsb"] > 0

    def test_curve_covers_every_day_in_range(self):
        curve = L.load_curve({"2026-03-01": 100}, date(2026, 3, 1), date(2026, 3, 31))
        assert len(curve) == 31
        assert curve[0]["day"] == "2026-03-01" and curve[-1]["day"] == "2026-03-31"


class TestRampRate:
    def test_none_without_enough_history(self):
        curve = L.load_curve({"2026-01-01": 100}, date(2026, 1, 1), date(2026, 1, 5))
        assert L.ramp_rate(curve, window_days=7) is None

    def test_none_when_the_earlier_ctl_is_effectively_zero(self):
        """A percentage change from zero is meaningless, not infinite."""
        loads = {f"2026-02-{d:02d}": 100 for d in range(1, 15)}
        curve = L.load_curve(loads, date(2026, 1, 1), date(2026, 2, 14))
        # first 31 days are all zero load, so CTL at day -8 is exactly 0
        assert L.ramp_rate(curve[:32], window_days=7) is None

    def test_positive_while_building(self):
        curve = L.load_curve({f"2026-01-{d:02d}": 90 for d in range(1, 29)},
                             date(2026, 1, 1), date(2026, 1, 28))
        assert L.ramp_rate(curve, 7) > 0

    def test_negative_during_a_taper(self):
        loads = {f"2026-01-{d:02d}": 90 for d in range(1, 29)}
        loads.update({f"2026-02-{d:02d}": 0 for d in range(1, 15)})
        curve = L.load_curve(loads, date(2026, 1, 1), date(2026, 2, 14))
        assert L.ramp_rate(curve, 7) < 0


class TestWeeklyLoads:
    def test_iso_week_bucketing_and_start_day(self):
        curve = L.load_curve({f"2026-01-{d:02d}": 10 for d in range(5, 19)},
                             date(2026, 1, 5), date(2026, 1, 18))
        weeks = L.weekly_loads(curve)
        assert [w["week"] for w in weeks] == ["2026-W02", "2026-W03"]
        assert weeks[0]["start"] == "2026-01-05"   # a Monday
        assert weeks[0]["load"] == pytest.approx(70.0)

    def test_overreaching_flags_on_ctl_ramp_not_raw_load(self):
        """A 3:1 mesocycle swings raw weekly load ±40 % by design.

        Flagging that would fire every fourth week. The flag is on the CTL ramp.
        """
        # Four identical weeks after a long steady base: CTL is flat, so no flag,
        # even though week-on-week raw load wobbles.
        loads = {}
        d = date(2026, 1, 1)
        from datetime import timedelta

        for i in range(200):
            loads[(d + timedelta(days=i)).isoformat()] = 80
        curve = L.load_curve(loads, d, d + timedelta(days=199))
        weeks = L.weekly_loads(curve)
        assert not any(w["overreaching"] for w in weeks[-6:])
        assert all(abs(w["ctl_delta_pct"]) < 5 for w in weeks[-6:])

    def test_first_week_has_no_deltas(self):
        curve = L.load_curve({"2026-01-05": 50}, date(2026, 1, 5), date(2026, 1, 11))
        weeks = L.weekly_loads(curve)
        assert weeks[0]["delta_pct"] is None
        assert weeks[0]["ctl_delta_pct"] is None


class TestFormLabel:
    @pytest.mark.parametrize("tsb, expect", [
        (30, "very fresh (detraining risk)"),
        (10, "fresh"),
        (0, "neutral"),
        (-15, "fatigued (productive)"),
        (-40, "very fatigued"),
    ])
    def test_bands(self, tsb, expect):
        assert L.form_label(tsb) == expect


class TestComputeLoadAgainstStore:
    def test_empty_store_is_empty_not_an_exception(self, store):
        out = L.compute_load(store)
        assert out == {"curve": [], "weeks": [], "current": None, "ramp_pct": None}

    def test_seeded_store_produces_a_plausible_curve(self, seeded_store):
        out = L.compute_load(seeded_store)
        assert out["curve"], "seeded data should produce a curve"
        cur = out["current"]
        assert 10 < cur["ctl"] < 200
        assert cur["tsb"] == pytest.approx(cur["ctl"] - cur["atl"], abs=0.02)
        assert out["warmup_until"] > out["curve"][0]["day"]

    def test_warmup_window_is_one_ctl_time_constant(self, seeded_store):
        out = L.compute_load(seeded_store)
        first = date.fromisoformat(out["curve"][0]["day"])
        assert (date.fromisoformat(out["warmup_until"]) - first).days == L.CTL_TAU_DAYS

    def test_curve_runs_to_today_so_rest_days_count(self, seeded_store):
        """Form is read off the last point. Ending it at the last activity froze fatigue
        at its post-workout value for as long as the athlete then rested."""
        last = date.fromisoformat(max(L.daily_loads(seeded_store)))
        today = last + timedelta(days=3)

        out = L.compute_load(seeded_store, today=today)

        assert out["curve"][-1]["day"] == today.isoformat()
        assert [point["load"] for point in out["curve"][-3:]] == [0.0, 0.0, 0.0]
        # Three rest days: fatigue (7-day constant) falls faster than fitness (42-day),
        # so form must have risen.
        before = L.compute_load(seeded_store, today=last)["current"]
        assert out["current"]["tsb"] > before["tsb"]
        assert out["current"]["day"] == today.isoformat()

    def test_an_explicit_end_still_wins_over_today(self, seeded_store):
        last = date.fromisoformat(max(L.daily_loads(seeded_store)))
        out = L.compute_load(seeded_store, end=last.isoformat(), today=last + timedelta(days=9))
        assert out["curve"][-1]["day"] == last.isoformat()

    def test_a_future_activity_is_not_cut_off_by_today(self, seeded_store):
        last = date.fromisoformat(max(L.daily_loads(seeded_store)))
        out = L.compute_load(seeded_store, today=last - timedelta(days=5))
        assert out["curve"][-1]["day"] == last.isoformat()
