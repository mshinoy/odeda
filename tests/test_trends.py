"""Rolling baselines and z-scores — the early-warning layer."""

from __future__ import annotations

import pytest

from odeda.analytics import trends as T


class TestStatistics:
    def test_sample_stdev_uses_n_minus_one(self):
        """[1,2,3,4,5]: mean 3, Σ(x−μ)² = 10, /(n−1)=4 → 2.5, √2.5 = 1.5811388300841898."""
        assert T.stdev([1, 2, 3, 4, 5]) == pytest.approx(1.5811388300841898, abs=1e-12)

    def test_stdev_needs_two_observations(self):
        assert T.stdev([]) is None
        assert T.stdev([5]) is None
        assert T.stdev([5, None]) is None

    def test_stdev_of_a_constant_series_is_zero(self):
        assert T.stdev([7, 7, 7, 7]) == 0.0

    def test_mean_ignores_missing(self):
        assert T.mean([1, None, 3]) == pytest.approx(2.0)
        assert T.mean([None, None]) is None


class TestZScore:
    def test_hand_checked(self):
        """value 7 against [1,2,3,4,5]: (7−3) / 1.5811388300841898 = 2.5298221281347035."""
        assert T.zscore(7, [1, 2, 3, 4, 5]) == pytest.approx(2.5298221281347035, abs=1e-12)

    def test_value_at_the_mean_is_zero(self):
        assert T.zscore(3, [1, 2, 3, 4, 5]) == pytest.approx(0.0)

    def test_sign_follows_direction(self):
        assert T.zscore(1, [1, 2, 3, 4, 5]) < 0

    def test_none_when_the_baseline_has_no_spread(self):
        """A constant baseline cannot say how unusual anything is."""
        assert T.zscore(10, [7, 7, 7, 7]) is None

    def test_none_when_the_value_is_missing(self):
        assert T.zscore(None, [1, 2, 3]) is None

    def test_none_with_too_little_baseline(self):
        assert T.zscore(5, [3]) is None

    def test_missing_baseline_points_are_dropped(self):
        assert T.zscore(7, [1, None, 2, 3, None, 4, 5]) == pytest.approx(2.5298221281347035)


class TestRollingMean:
    def test_trailing_window(self):
        assert T.rolling_mean([1, 2, 3, 4, 5], 3) == pytest.approx([1, 1.5, 2, 3, 4])

    def test_window_longer_than_the_series(self):
        assert T.rolling_mean([2, 4], 10) == pytest.approx([2.0, 3.0])

    def test_gaps_are_skipped_not_zero_filled(self):
        """A missing night is missing, not a zero — averaging it in would be a lie."""
        assert T.rolling_mean([10, None, 20], 3) == pytest.approx([10.0, 10.0, 15.0])

    def test_leading_gap_gives_none(self):
        assert T.rolling_mean([None, 10], 2)[0] is None


class TestSeriesTrend:
    def _series(self, values):
        days = [f"2026-01-{i + 1:02d}" for i in range(len(values))]
        return days, values

    def test_baseline_excludes_today(self):
        """Today must be scored against history, not against itself."""
        days, values = self._series([50.0] * 30 + [80.0])
        out = T.series_trend(days, values, "sleep_score")
        assert out["baseline_mean"] == pytest.approx(50.0)
        # a zero-spread baseline cannot produce a z-score
        assert out["z"] is None

    def test_flags_a_high_value_on_a_lower_is_better_metric(self):
        """Resting HR spiking well above its baseline is the classic illness signal."""
        import random

        rng = random.Random(1)
        values = [50 + rng.gauss(0, 1) for _ in range(60)] + [60.0]
        out = T.series_trend([f"d{i}" for i in range(61)], values, "resting_hr")
        assert out["z"] > T.Z_FLAG
        assert out["flagged"] is True
        assert out["verdict"] == "worse than baseline"

    def test_same_deviation_on_a_higher_is_better_metric_reads_as_good(self):
        import random

        rng = random.Random(1)
        values = [50 + rng.gauss(0, 1) for _ in range(60)] + [60.0]
        out = T.series_trend([f"d{i}" for i in range(61)], values, "hrv")
        assert out["verdict"] == "better than baseline"
        assert out["flagged"] is True

    def test_within_band_is_normal(self):
        import random

        rng = random.Random(7)
        values = [50 + rng.gauss(0, 2) for _ in range(60)] + [50.5]
        out = T.series_trend([f"d{i}" for i in range(61)], values, "resting_hr")
        assert out["flagged"] is False
        assert out["verdict"] == "normal"

    def test_insufficient_data_says_so(self):
        out = T.series_trend(["d0"], [50.0], "hrv")
        assert out["z"] is None
        assert out["verdict"] == "insufficient data"

    def test_rolling_windows_are_all_present_and_aligned(self):
        days, values = self._series([float(i) for i in range(30)])
        out = T.series_trend(days, values, "sleep_score")
        for key in ("roll7", "roll28", "roll90", "values"):
            assert len(out[key]) == 30

    def test_unknown_metric_defaults_to_higher_is_better(self):
        import random

        rng = random.Random(3)
        values = [50 + rng.gauss(0, 1) for _ in range(60)] + [60.0]
        out = T.series_trend([f"d{i}" for i in range(61)], values, "something_new")
        assert out["verdict"] == "better than baseline"


class TestComputeTrends:
    def test_empty_store(self, store):
        assert T.compute_trends(store) == {"metrics": {}, "flags": []}

    def test_seeded_store_produces_every_metric(self, seeded_store):
        out = T.compute_trends(seeded_store, days=90)
        assert set(out["metrics"]) == set(T.TREND_METRICS)
        for metric, t in out["metrics"].items():
            assert t["metric"] == metric
            assert t["latest"] is not None

    def test_flags_are_a_subset_of_the_metrics(self, seeded_store):
        out = T.compute_trends(seeded_store, days=90)
        for flag in out["flags"]:
            assert flag["metric"] in out["metrics"]
            assert abs(flag["z"]) >= T.Z_FLAG

    def test_metric_subset_is_respected(self, seeded_store):
        out = T.compute_trends(seeded_store, days=90, metrics=["hrv"])
        assert list(out["metrics"]) == ["hrv"]

    def test_illness_block_shows_up_as_a_resting_hr_spike(self, seeded_store):
        """The seeder writes an illness window; the trend engine must be able to see it.

        This is the end-to-end check that the z-score machinery finds a real event
        rather than only responding to handcrafted arrays.
        """
        rows = seeded_store.query("SELECT day, resting_hr FROM daily_wellness ORDER BY day")
        values = [r["resting_hr"] for r in rows]
        peak = max(values)
        baseline = T.mean(values)
        sd = T.stdev(values)
        assert (peak - baseline) / sd > 2.0, "illness should push RHR past 2σ"
