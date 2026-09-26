"""The seeded weigh-in series.

The owner has never owned a Garmin scale, so `body_composition` has no real rows and
every body-composition analytic and chart in Phase 5 is demonstrated against this. That
makes the *shape* of the synthetic series load-bearing rather than decorative:

  * a single reading has to be noisier than a week of them, or the smoothed trend that
    is the headline of the Health section would be smoothing nothing;
  * the readings have to come in runs with real gaps, or weigh-in consistency has
    nothing to measure and the gap-aware EWMA is never exercised;
  * fat mass and lean mass have to move differently, or the split chart is two parallel
    lines and proves nothing.

These tests pin those three properties. They are statistical, so each asserts a wide
band around a number measured from the generator, not the number itself.
"""

from __future__ import annotations

import random
from datetime import date

import pytest

from garmin_analytics.seed import synthetic as S


def rolling_mean(values: list[float], window: int) -> list[float]:
    return [
        sum(values[max(0, i - window + 1) : i + 1]) / len(values[max(0, i - window + 1) : i + 1])
        for i in range(len(values))
    ]


def mean_step(values: list[float]) -> float:
    """Mean absolute day-to-day change: how much the series jumps about."""
    return sum(abs(values[i] - values[i - 1]) for i in range(1, len(values))) / (len(values) - 1)


def gap_lengths(hits: list[bool]) -> list[int]:
    gaps: list[int] = []
    run = 0
    for hit in hits:
        if hit:
            if run:
                gaps.append(run)
            run = 0
        else:
            run += 1
    if run:
        gaps.append(run)
    return gaps


class TestTheHabit:
    """`steps_on_the_scale` on its own, over enough days for the runs to show."""

    @pytest.mark.parametrize("seed", [1, 7, 42])
    def test_about_five_mornings_a_week(self, seed):
        rng = random.Random(seed)
        state = S.AthleteState()
        hits = [S.steps_on_the_scale(rng, state) for _ in range(1000)]
        assert 0.55 <= sum(hits) / len(hits) <= 0.85

    @pytest.mark.parametrize("seed", [1, 7, 42])
    def test_the_habit_lapses_for_weeks_at_a_time(self, seed):
        """The property an independent per-day coin flip cannot have.

        At the ~69 % coverage this produces, an independent flip would miss eight days
        in a row with probability 0.31**8 ≈ 1 in 12,000 — under one occurrence per
        1,000 days. The sticky habit produces several, which is the point: every trend
        downstream degrades with gaps and has to be shown coping with real ones.
        """
        rng = random.Random(seed)
        state = S.AthleteState()
        hits = [S.steps_on_the_scale(rng, state) for _ in range(1000)]
        long_gaps = [g for g in gap_lengths(hits) if g >= 8]
        assert len(long_gaps) >= 2


@pytest.fixture(scope="module")
def eighteen_months(tmp_path_factory):
    """A block long enough for the weight to actually go somewhere."""
    import os

    from garmin_analytics.config import load_settings
    from garmin_analytics.db.store import Store

    tmp = tmp_path_factory.mktemp("seedbody")
    old = os.environ.get("GA_DB"), os.environ.get("GA_DATA_DIR")
    os.environ["GA_DB"] = str(tmp / "body.db")
    os.environ["GA_DATA_DIR"] = str(tmp)
    try:
        store = Store.open(load_settings())
        S.seed_database(store, end=date(2026, 9, 22), months=18, reset=True)
        yield store
        store.close()
    finally:
        for name, value in zip(("GA_DB", "GA_DATA_DIR"), old):
            if value is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = value


@pytest.fixture(scope="module")
def readings(eighteen_months):
    return eighteen_months.query(
        "SELECT day, weight_kg, body_fat_pct, bmi FROM body_composition ORDER BY day"
    )


class TestTheSeededSeries:
    def test_there_are_enough_readings_to_plot(self, eighteen_months, readings):
        days = eighteen_months.scalar("SELECT COUNT(*) FROM daily_wellness")
        assert 0.5 <= len(readings) / days <= 0.85

    def test_one_reading_is_noisier_than_a_week_of_them(self, readings):
        """The headline claim of the whole phase, pinned in the data it is shown on.

        Day to day the scale moves ~0.6 kg; a 7-reading trailing mean moves ~0.1 kg.
        A factor of 6 measured here, asserted at 3 so ordinary variation between seeds
        cannot fail it. If this ratio ever approached 1, presenting a single reading as
        a trend would be defensible — and it is not.
        """
        weights = [r["weight_kg"] for r in readings]
        assert mean_step(weights) >= 3 * mean_step(rolling_mean(weights, 7))

    def test_hydration_noise_is_a_scale_reading_not_a_body(self, readings):
        """Noise on one morning is under a kilogram; a block's real change is several.

        This is what separates "you are up 0.7 kg today" (nothing) from "you are down
        4 kg over the block" (everything), and it is the reason the raw weigh-ins are
        drawn faint behind the trend rather than as the series.
        """
        weights = [r["weight_kg"] for r in readings]
        assert mean_step(weights) < 1.0
        assert max(weights) - min(weights) > 3.0

    def test_the_weight_does_not_fall_along_a_straight_line(self, readings):
        """A plateau has to exist, or smoothing only ever reveals the line it was given.

        Fortnight to fortnight the trend must go *up* somewhere in eighteen months of
        losing weight, because real weight loss stalls and regains.
        """
        trend = rolling_mean([r["weight_kg"] for r in readings], 14)
        assert any(trend[i] > trend[i - 14] for i in range(14, len(trend)))

    def test_fat_mass_falls_and_lean_mass_does_not(self, readings):
        """Losing fat and losing muscle look identical on a scale. Here they must not.

        Measured over the first and last 30 readings of an eighteen-month block: fat
        mass falls ~4.3 kg while lean mass rises ~0.7 kg. Asserted loosely, but with
        the signs opposite, because a split chart on which both lines fall together
        would be telling the owner something untrue about their training.
        """
        fat = [r["weight_kg"] * r["body_fat_pct"] / 100.0 for r in readings]
        lean = [r["weight_kg"] - f for r, f in zip(readings, fat)]
        fat_change = sum(fat[-30:]) / 30 - sum(fat[:30]) / 30
        lean_change = sum(lean[-30:]) / 30 - sum(lean[:30]) / 30
        assert fat_change < -2.0
        assert lean_change > 0.0

    def test_body_fat_stays_in_a_human_range(self, readings):
        percentages = [r["body_fat_pct"] for r in readings]
        assert 8.0 <= min(percentages) and max(percentages) <= 30.0

    def test_bmi_agrees_with_the_weight_it_was_measured_with(self, readings):
        """BMI is that morning's reading over the same height, not a second draw.

        It used to be generated with its own independent noise, so a row could report a
        weight that was down and a BMI that was up. Nothing consumed both at once, which
        is the only reason it went unnoticed.
        """
        for row in readings:
            expected = row["weight_kg"] / (S.HEIGHT_M**2)
            assert abs(row["bmi"] - expected) <= 0.06, row["day"]
