"""Kilometre splits are moving time (`api.server._splits`)."""

from __future__ import annotations

import pytest

from odeda.api.server import _splits


def stream(points):
    """`points`: (elapsed_s, distance_m)."""
    return [{"elapsed_s": t, "distance_m": d, "hr": 140} for t, d in points]


def steady(seconds_per_km: float, km: int, step_s: float = 10.0):
    """A steady athlete: a sample every `step_s`, covering a kilometre in `seconds_per_km`."""
    speed = 1000.0 / seconds_per_km
    n = int(km * seconds_per_km / step_s)
    return [(i * step_s, i * step_s * speed) for i in range(n + 1)]


class TestSplits:
    def test_a_steady_run_has_a_split_a_kilometre_at_its_pace(self):
        splits = _splits(stream(steady(300, 3)))
        assert [s["km"] for s in splits] == [1, 2, 3]
        assert all(s["seconds"] == pytest.approx(300, abs=1) for s in splits)

    def test_standing_still_is_not_part_of_the_kilometre(self):
        """A two-minute stop at a light in the second kilometre: still a 300 s kilometre."""
        points = steady(300, 1)
        end_t, end_d = points[-1]
        points += [(end_t + 60, end_d), (end_t + 120, end_d)]  # stopped, distance unchanged
        resume = end_t + 120
        points += [(resume + t, end_d + d) for t, d in steady(300, 1)[1:]]
        splits = _splits(stream(points))
        assert splits[0]["seconds"] == pytest.approx(300, abs=1)
        assert splits[1]["seconds"] == pytest.approx(300, abs=1)  # not 420

    def test_a_pause_where_the_watch_resumed_elsewhere_is_not_a_kilometre_of_slow_riding(self):
        """The 7 Nov ride: 28 minutes gone, and 10 m of recorded distance across them."""
        points = steady(120, 1)
        t, d = points[-1]
        points += [(t + 1707, d + 10)]  # the gap
        resume = t + 1707
        points += [(resume + tt, d + 10 + dd) for tt, dd in steady(120, 2)[1:]]
        splits = _splits(stream(points))
        assert all(s["seconds"] == pytest.approx(120, abs=3) for s in splits)

    def test_the_splits_add_up_to_the_moving_time(self):
        points = steady(300, 2)
        t, d = points[-1]
        points += [(t + 500, d)]  # a long stop
        points += [(t + 500 + tt, d + dd) for tt, dd in steady(300, 1)[1:]]
        total = sum(s["seconds"] for s in _splits(stream(points)))
        assert total == pytest.approx(900, abs=3)

    def test_a_walk_break_still_counts_as_moving(self):
        """1.2 m/s is slow, and it is still going somewhere."""
        points = [(i * 10.0, i * 12.0) for i in range(0, 90)]  # 1.2 m/s for 890 s
        [split] = _splits(stream(points))[:1]
        assert split["seconds"] == pytest.approx(1000 / 1.2, abs=12)

    def test_samples_without_distance_are_skipped(self):
        rows = stream(steady(300, 2))
        rows.insert(3, {"elapsed_s": 25.0, "distance_m": None, "hr": 130})
        assert len(_splits(rows)) == 2

    def test_too_few_samples_is_no_splits(self):
        assert _splits([]) == []
        assert _splits(stream([(0, 0)])) == []

    def test_the_average_heart_rate_is_still_the_kilometre_s_own(self):
        splits = _splits(stream(steady(300, 1)))
        assert splits[0]["avg_hr"] == 140
