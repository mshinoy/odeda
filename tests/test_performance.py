"""Performance maths: Riegel, best-effort extraction, decoupling, efficiency factor."""

from __future__ import annotations

import pytest

from garmin_analytics.analytics import performance as P


class TestRiegel:
    def test_5k_to_half_marathon_hand_checked(self):
        """20:00 (1200 s) for 5 k projected to 21 097.5 m.

        ratio      = 21097.5 / 5000 = 4.2195
        ratio^1.06 = e^(1.06 × ln 4.2195) = e^(1.06 × 1.4397979) = e^1.5261858 = 4.6001993
        1200 × 4.6001993 = 5520.2392 s = 1:32:00
        """
        assert P.riegel(1200, 5000, 21097.5) == pytest.approx(5520.239199907903, abs=1e-6)

    def test_downward_projection_hand_checked(self):
        """40:00 (2400 s) for 10 k projected down to 5 k.

        ratio^1.06 = 0.5^1.06 = e^(1.06 × −0.6931472) = e^−0.7347360 = 0.4796321
        2400 × 0.4796321 = 1151.1169 s = 19:11
        """
        assert P.riegel(2400, 10000, 5000) == pytest.approx(1151.1169431903172, abs=1e-6)

    def test_same_distance_is_the_identity(self):
        assert P.riegel(1800, 10000, 10000) == pytest.approx(1800)

    def test_exponent_above_one_penalises_distance(self):
        """A pure linear scaling would give 2400 s; Riegel gives more, as it must."""
        assert P.riegel(1200, 5000, 10000) > 2400

    def test_exponent_is_overridable(self):
        assert P.riegel(1200, 5000, 10000, exponent=1.0) == pytest.approx(2400)

    @pytest.mark.parametrize("args", [(0, 5000, 10000), (1200, 0, 10000), (1200, 5000, 0),
                                      (-1, 5000, 10000)])
    def test_rejects_non_positive_inputs(self, args):
        with pytest.raises(ValueError):
            P.riegel(*args)


class TestBestEffort:
    def test_exact_on_a_constant_pace_stream(self):
        """1 m/s for 2000 s: the fastest 1000 m is exactly 1000 s."""
        elapsed = list(range(0, 2001, 10))
        dist = [float(t) for t in elapsed]
        assert P.best_effort_for_distance(dist, elapsed, 1000) == pytest.approx(1000.0, abs=1e-6)

    def test_finds_the_fast_segment_not_the_average(self):
        """2 m/s for 300 s, then 5 m/s for 300 s.

        Whole-activity average is 3.5 m/s → 285.7 s per km. The best 1000 m sits
        entirely inside the fast half: 1000 / 5 = 200.0 s exactly.
        """
        elapsed, dist, d = [], [], 0.0
        for t in range(0, 601, 10):
            speed = 2.0 if t <= 300 else 5.0
            if t:
                d += speed * 10
            elapsed.append(t)
            dist.append(d)
        assert P.best_effort_for_distance(dist, elapsed, 1000) == pytest.approx(200.0, abs=1e-6)

    def test_interpolates_the_entry_point(self):
        """Coarse 60 s sampling at 5 m/s: without interpolation a 1 000 m best would
        quantise to 240 s (4 whole samples). With it, the answer is 200 s."""
        elapsed = list(range(0, 601, 60))
        dist = [5.0 * t for t in elapsed]
        assert P.best_effort_for_distance(dist, elapsed, 1000) == pytest.approx(200.0, abs=1e-6)

    def test_none_when_the_distance_is_never_covered(self):
        elapsed = list(range(0, 101, 10))
        dist = [1.0 * t for t in elapsed]
        assert P.best_effort_for_distance(dist, elapsed, 5000) is None

    def test_none_on_degenerate_input(self):
        assert P.best_effort_for_distance([], [], 1000) is None
        assert P.best_effort_for_distance([0.0], [0.0], 1000) is None
        assert P.best_effort_for_distance([0.0, 10.0], [0.0], 5) is None

    def test_exactly_the_target_distance(self):
        elapsed = [0, 100, 200]
        dist = [0.0, 500.0, 1000.0]
        assert P.best_effort_for_distance(dist, elapsed, 1000) == pytest.approx(200.0)

    def test_monotonic_in_target_distance(self):
        elapsed = list(range(0, 3001, 10))
        dist = [3.0 * t for t in elapsed]
        assert (P.best_effort_for_distance(dist, elapsed, 5000)
                > P.best_effort_for_distance(dist, elapsed, 1000))


class TestAerobicDecoupling:
    # Shared fixture: 1200 s at a constant 3 m/s, HR 150 for the first half and
    # 165 for the second, sampled every 100 s.
    ELAPSED = [i * 100 for i in range(13)]
    DIST = [3.0 * t for t in ELAPSED]

    def test_hand_checked_step_change(self):
        """HR steps 150 → 165 at the midpoint sample (index 6, t = 600).

        first half  : 1800 m / 600 s = 3 m/s; time-weighted mean HR = 150
                      ratio = 3 / 150 = 0.02
        second half : 1800 m / 600 s = 3 m/s; the 600→700 s segment averages
                      (150+165)/2 = 157.5, the remaining 500 s are 165
                      mean = (157.5×100 + 165×500) / 600 = 98250 / 600 = 163.75
                      ratio = 3 / 163.75 = 0.018320610687…
        decoupling  = (0.02 − 0.018320610687) / 0.02 × 100 = 8.396946564885…%
        """
        hr = [150] * 7 + [165] * 6
        assert P.aerobic_decoupling(self.ELAPSED, self.DIST, hr) == pytest.approx(
            8.396946564885495, abs=1e-9
        )

    def test_zero_when_nothing_drifts(self):
        hr = [150] * 13
        assert P.aerobic_decoupling(self.ELAPSED, self.DIST, hr) == pytest.approx(0.0, abs=1e-9)

    def test_negative_when_the_second_half_is_cheaper(self):
        """Negative coupling: speed held, HR fell. A negative split feels like this."""
        hr = [165] * 7 + [150] * 6
        assert P.aerobic_decoupling(self.ELAPSED, self.DIST, hr) < 0

    def test_slowing_at_constant_hr_also_decouples(self):
        """The metric is speed *per heartbeat*: losing pace at the same HR counts."""
        elapsed = [i * 100 for i in range(13)]
        dist, d = [0.0], 0.0
        for i in range(1, 13):
            d += (3.0 if i <= 6 else 2.4) * 100
            dist.append(d)
        assert P.aerobic_decoupling(elapsed, dist, [150] * 13) > 15

    def test_time_weighting_ignores_sample_density(self):
        """Doubling the sample rate in one stretch must not change the answer."""
        hr = [150] * 7 + [165] * 6
        base = P.aerobic_decoupling(self.ELAPSED, self.DIST, hr)

        dense_e, dense_d, dense_h = [], [], []
        for i, t in enumerate(self.ELAPSED):
            dense_e.append(t)
            dense_d.append(self.DIST[i])
            dense_h.append(hr[i])
            if 700 <= t < 1200:   # insert a midpoint sample in the second half
                dense_e.append(t + 50)
                dense_d.append(self.DIST[i] + 150.0)
                dense_h.append(hr[i])
        assert P.aerobic_decoupling(dense_e, dense_d, dense_h) == pytest.approx(base, abs=1e-6)

    @pytest.mark.parametrize("elapsed, dist, hr", [
        ([0, 1], [0, 3], [150, 150]),                    # too few samples
        ([0] * 6, [0] * 6, [150] * 6),                   # no elapsed time
        ([0, 1, 2, 3], [0, 0, 0, 0], [150] * 4),         # no distance
        ([0, 100, 200, 300], [0, 1, 2, 3], [None] * 4),  # no HR at all
    ])
    def test_none_on_unusable_input(self, elapsed, dist, hr):
        assert P.aerobic_decoupling(elapsed, dist, hr) is None

    def test_length_mismatch_is_none_not_a_crash(self):
        assert P.aerobic_decoupling([0, 1, 2, 3], [0, 1, 2], [150] * 4) is None


class TestEfficiencyFactor:
    def test_hand_checked(self):
        """10 000 m in 3000 s at 150 bpm.

        speed = 10000 / 50 min = 200 m/min; EF = 200 / 150 = 1.3333…
        """
        assert P.efficiency_factor(10000, 3000, 150) == pytest.approx(4.0 / 3.0, abs=1e-9)

    def test_rises_when_the_same_pace_costs_fewer_beats(self):
        assert P.efficiency_factor(10000, 3000, 140) > P.efficiency_factor(10000, 3000, 150)

    @pytest.mark.parametrize("args", [(10000, 0, 150), (10000, 3000, 0), (10000, 3000, None)])
    def test_none_on_unusable_input(self, args):
        assert P.efficiency_factor(*args) is None


class TestFormatters:
    @pytest.mark.parametrize("secs, expect", [(59, "0:59"), (60, "1:00"), (3599, "59:59"),
                                              (3600, "1:00:00"), (5520.2, "1:32:00")])
    def test_hms(self, secs, expect):
        assert P.hms(secs) == expect

    @pytest.mark.parametrize("spk, expect", [(300, "5:00/km"), (263.5, "4:24/km"), (59.6, "1:00/km")])
    def test_pace_str(self, spk, expect):
        assert P.pace_str(spk) == expect


class TestAgainstSeededStore:
    def test_best_efforts_are_internally_consistent(self, seeded_store):
        pbs = {p["label"]: p for p in P.personal_bests(seeded_store)}
        assert "1 k" in pbs and "5 k" in pbs
        # A 5 k best can never be faster than five times the 1 k best.
        assert pbs["5 k"]["seconds"] > pbs["1 k"]["seconds"]
        # …and pace over the longer distance must be slower.
        assert pbs["5 k"]["seconds"] / 5 > pbs["1 k"]["seconds"]

    def test_best_effort_beats_or_matches_the_whole_activity_average(self, seeded_store):
        """The fastest window inside a run is never slower than the run's own average."""
        rows = seeded_store.query(
            "SELECT b.activity_id, b.seconds, a.distance_m, a.moving_time_s "
            "FROM best_efforts b JOIN activities a USING (activity_id) "
            "WHERE b.distance_m = 5000 AND a.distance_m > 6000 LIMIT 20"
        )
        assert rows, "seeded data should contain runs longer than 6 km"
        for r in rows:
            whole_pace = r["moving_time_s"] / (r["distance_m"] / 1000.0)
            best_pace = r["seconds"] / 5.0
            assert best_pace <= whole_pace + 1e-6

    def test_rebuild_best_efforts_is_idempotent(self, seeded_store):
        before = seeded_store.scalar("SELECT COUNT(*) FROM best_efforts")
        P.rebuild_best_efforts(seeded_store)
        assert seeded_store.scalar("SELECT COUNT(*) FROM best_efforts") == before

    def test_decoupling_history_only_covers_long_runs(self, seeded_store):
        for row in P.decoupling_history(seeded_store):
            assert row["duration_s"] >= P.DECOUPLING_MIN_DURATION_S

    def test_compute_performance_shape(self, seeded_store):
        out = P.compute_performance(seeded_store)
        assert set(out) >= {"personal_bests", "recent_bests_90d", "decoupling", "vo2max",
                            "efficiency_trend"}
        assert out["vo2max"], "seeded fitness rows should carry VO2max"


class TestPlausibleSegments:
    """A GPS teleport must not become a personal best.

    Observed on real data 2026-09-23: an easy run (5.78 km in 43 min) carried one
    sample adding 840 m in 8 s — 105 m/s. Swept raw, that produced a 1 km best of 79 s,
    a 1 mile of 3:02 and a 5 km of 12:28, all of which then fed the race projection.
    """

    def test_a_clean_stream_is_one_segment(self):
        dist = [0, 100, 200, 300, 400]
        elapsed = [0, 30, 60, 90, 120]
        assert P.plausible_segments(dist, elapsed) == [(0, 5)]

    def test_a_teleport_splits_the_stream(self):
        dist = [0, 100, 940, 1040, 1140]      # +840 m between samples 1 and 2
        elapsed = [0, 30, 38, 68, 98]
        assert P.plausible_segments(dist, elapsed) == [(0, 2), (2, 5)]

    def test_distance_going_backwards_also_splits(self):
        dist = [0, 100, 200, 150, 250, 350]
        elapsed = [0, 30, 60, 90, 120, 150]
        assert P.plausible_segments(dist, elapsed) == [(0, 3), (3, 6)]

    def test_a_real_sprint_is_not_split(self):
        """The ceiling has to clear genuine running. 10 m/s is a 1:40/km sprint."""
        dist = [0, 100, 200, 300]
        elapsed = [0, 10, 20, 30]
        assert P.plausible_segments(dist, elapsed) == [(0, 4)]

    def test_the_fast_window_across_a_teleport_is_not_reported(self):
        """The end-to-end guard: 1 km 'covered' in 38 s only because of the jump."""
        dist = [0, 100, 940, 1040]
        elapsed = [0, 30, 38, 68]
        segments = P.plausible_segments(dist, elapsed)
        best = None
        for lo, hi in segments:
            t = P.best_effort_for_distance(dist[lo:hi], elapsed[lo:hi], 1000)
            if t is not None and (best is None or t < best):
                best = t
        assert best is None, "no segment legitimately covers 1 km"
        assert P.best_effort_for_distance(dist, elapsed, 1000) is not None, (
            "the unfiltered sweep does report it — which is the bug"
        )
