"""The synthetic seeder.

Two jobs here. One: the seeder is deterministic and idempotent. Two — and this is the
point — the data it produces is *physiologically coherent*, because every other test in
this suite reads it, and analytics validated against incoherent data prove nothing.
"""

from __future__ import annotations

from datetime import date, timedelta

import pytest

from garmin_analytics.analytics import load as L
from garmin_analytics.seed import synthetic as S


class TestSeedMechanics:
    def test_seeds_the_expected_volume(self, store):
        counts = S.seed_database(store, end=date(2026, 9, 22), months=3, reset=True)
        assert 85 <= counts["days"] <= 95
        assert counts["activities"] > 50
        assert counts["samples"] > 5000
        assert counts["raw"] > 300
        assert counts["best_efforts"] > 50

    def test_is_deterministic(self, tmp_path, settings):
        """Same seed, same output — the verification transcript has to reproduce."""
        from garmin_analytics.db.store import Store

        digests = []
        for name in ("a.db", "b.db"):
            st = Store.open(settings.__class__(**{**settings.__dict__,
                                                  "db_path": tmp_path / name}))
            S.seed_database(st, end=date(2026, 9, 22), months=2, reset=True)
            digests.append(st.query(
                "SELECT activity_id, day, ROUND(distance_m, 3) d, ROUND(trimp, 3) t "
                "FROM activities ORDER BY activity_id"
            ))
            st.close()
        assert digests[0] == digests[1]

    def test_reseeding_with_reset_does_not_accumulate(self, store):
        first = S.seed_database(store, end=date(2026, 9, 22), months=2, reset=True)
        second = S.seed_database(store, end=date(2026, 9, 22), months=2, reset=True)
        assert first == second
        assert store.scalar("SELECT COUNT(*) FROM activities") == first["activities"]

    def test_marks_itself_as_synthetic(self, store):
        assert S.is_synthetic(store) is False
        S.seed_database(store, end=date(2026, 9, 22), months=1, reset=True)
        assert S.is_synthetic(store) is True
        note = store.watermarks()
        marker = [w for w in note if w["endpoint"] == S.SEED_MARKER_ENDPOINT][0]
        assert "rng_seed" in marker["note"]

    def test_every_activity_is_archived_raw(self, store):
        S.seed_database(store, end=date(2026, 9, 22), months=1, reset=True)
        activities = store.scalar("SELECT COUNT(*) FROM activities")
        raw = store.scalar(
            "SELECT COUNT(*) FROM raw_documents WHERE endpoint = 'activities'"
        )
        assert raw == activities

    def test_normalised_rows_reference_their_raw_document(self, store):
        S.seed_database(store, end=date(2026, 9, 22), months=1, reset=True)
        orphans = store.scalar(
            "SELECT COUNT(*) FROM activities a "
            "LEFT JOIN raw_documents r ON r.id = a.raw_id WHERE r.id IS NULL"
        )
        assert orphans == 0


@pytest.fixture(scope="module")
def three_months(tmp_path_factory):
    import os

    from garmin_analytics.config import load_settings
    from garmin_analytics.db.store import Store

    tmp = tmp_path_factory.mktemp("seedcheck")
    old = os.environ.get("GA_DB"), os.environ.get("GA_DATA_DIR")
    os.environ["GA_DATA_DIR"] = str(tmp)
    os.environ["GA_DB"] = str(tmp / "s.db")
    try:
        st = Store.open(load_settings())
        S.seed_database(st, end=date(2026, 9, 22), months=6, reset=True)
        yield st
        st.close()
    finally:
        for k, v in zip(("GA_DB", "GA_DATA_DIR"), old):
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v


class TestPhysiologicalPlausibility:
    """If these fail, every analytics test that reads seeded data is testing nonsense."""

    def test_no_day_is_missing_from_the_wellness_series(self, three_months):
        days = [r["day"] for r in three_months.query(
            "SELECT day FROM daily_wellness ORDER BY day")]
        expected = (date.fromisoformat(days[-1]) - date.fromisoformat(days[0])).days + 1
        assert len(days) == expected

    def test_resting_hr_is_in_a_human_range(self, three_months):
        lo, hi = three_months.query(
            "SELECT MIN(resting_hr) lo, MAX(resting_hr) hi FROM daily_wellness")[0].values()
        assert 38 <= lo and hi <= 80

    def test_hrv_is_in_a_human_range(self, three_months):
        lo, hi = three_months.query(
            "SELECT MIN(last_night_avg) lo, MAX(last_night_avg) hi FROM hrv_daily")[0].values()
        assert 15 <= lo and hi <= 130

    def test_sleep_is_between_three_and_twelve_hours(self, three_months):
        row = three_months.query(
            "SELECT MIN(total_sleep_s) lo, MAX(total_sleep_s) hi FROM sleep")[0]
        assert 3 * 3600 <= row["lo"] and row["hi"] <= 12 * 3600

    def test_sleep_stages_never_exceed_the_total(self, three_months):
        bad = three_months.scalar(
            "SELECT COUNT(*) FROM sleep WHERE deep_s + light_s + rem_s > total_sleep_s * 1.02"
        )
        assert bad == 0

    def test_sleep_scores_are_bounded(self, three_months):
        row = three_months.query("SELECT MIN(sleep_score) lo, MAX(sleep_score) hi FROM sleep")[0]
        assert 0 <= row["lo"] and row["hi"] <= 100

    def test_body_battery_low_never_exceeds_high(self, three_months):
        assert three_months.scalar("SELECT COUNT(*) FROM daily_wellness WHERE bb_low > bb_high") == 0

    def test_running_paces_are_human(self, three_months):
        """2.0–6.5 m/s covers a shuffle to a sprint. Anything outside is a generator bug."""
        row = three_months.query(
            "SELECT MIN(avg_speed_mps) lo, MAX(avg_speed_mps) hi FROM activities "
            "WHERE activity_type = 'running'")[0]
        assert 2.0 <= row["lo"] and row["hi"] <= 6.5

    def test_average_hr_never_exceeds_max_hr(self, three_months):
        assert three_months.scalar(
            "SELECT COUNT(*) FROM activities WHERE avg_hr > max_hr") == 0

    def test_max_hr_stays_under_the_configured_ceiling(self, three_months):
        assert three_months.scalar(
            "SELECT COUNT(*) FROM activities WHERE max_hr > ?", (S.HR_MAX + 1,)) == 0

    def test_zone_seconds_match_the_activity_duration(self, three_months):
        rows = three_months.query(
            "SELECT a.activity_id, a.moving_time_s, SUM(z.seconds) zs "
            "FROM activities a JOIN activity_hr_zones z USING (activity_id) "
            "WHERE a.activity_type = 'running' GROUP BY a.activity_id LIMIT 40"
        )
        assert rows
        for r in rows:
            assert r["zs"] == pytest.approx(r["moving_time_s"], rel=0.02)

    def test_sample_distance_matches_the_activity_distance(self, three_months):
        rows = three_months.query(
            "SELECT a.activity_id, a.distance_m, MAX(s.distance_m) sd "
            "FROM activities a JOIN activity_samples s USING (activity_id) "
            "GROUP BY a.activity_id LIMIT 40"
        )
        assert rows
        for r in rows:
            assert r["sd"] == pytest.approx(r["distance_m"], rel=0.001)

    def test_weekly_volume_is_a_realistic_range(self, three_months):
        from garmin_analytics.analytics import reports as Rep

        weeks = [w["run_km"] for w in Rep.weekly_report(three_months, limit=99)[1:-1]]
        assert weeks
        assert max(weeks) < 90, "nobody in this plan runs 90 km in a week"
        assert sum(weeks) / len(weeks) > 15

    def test_fitness_improves_over_the_block(self, three_months):
        """The whole point of the generator: a trajectory, not a random walk."""
        rows = three_months.query(
            "SELECT day, vo2max_run FROM fitness ORDER BY day")
        first = sum(r["vo2max_run"] for r in rows[:14]) / 14
        last = sum(r["vo2max_run"] for r in rows[-14:]) / 14
        assert last > first + 1.0

    def test_resting_hr_falls_as_fitness_rises(self, three_months):
        rows = three_months.query("SELECT resting_hr FROM daily_wellness ORDER BY day")
        first = sum(r["resting_hr"] for r in rows[:21]) / 21
        last = sum(r["resting_hr"] for r in rows[-21:]) / 21
        assert last < first

    def test_there_is_a_real_disruption_block(self, three_months):
        """The seeder writes an illness window — at least one run of 4+ zero-activity days."""
        days = {r["day"] for r in three_months.query("SELECT DISTINCT day FROM activities")}
        all_days = [r["day"] for r in three_months.query(
            "SELECT day FROM daily_wellness ORDER BY day")]
        longest = run = 0
        for d in all_days:
            run = run + 1 if d not in days else 0
            longest = max(longest, run)
        assert longest >= 4

    def test_the_disruption_shows_up_in_resting_hr(self, three_months):
        rows = three_months.query("SELECT day, resting_hr FROM daily_wellness ORDER BY day")
        values = [r["resting_hr"] for r in rows]
        mean = sum(values) / len(values)
        assert max(values) > mean + 4, "illness should be visible in resting HR"

    def test_aerobic_decoupling_improves(self, three_months):
        from garmin_analytics.analytics import performance as P

        dec = [d["decoupling_pct"] for d in P.decoupling_history(three_months)
               if d["decoupling_pct"] is not None]
        assert len(dec) > 20
        early = sum(dec[:10]) / 10
        late = sum(dec[-10:]) / 10
        assert late < early, "cardiac drift should shrink as the aerobic base builds"

    def test_ctl_reaches_a_trained_athletes_range(self, three_months):
        cur = L.compute_load(three_months)["current"]
        assert 40 < cur["ctl"] < 140

    def test_race_efforts_get_faster(self, three_months):
        rows = three_months.query(
            "SELECT day, distance_m, moving_time_s FROM activities "
            "WHERE activity_name = 'parkrun 5 k' ORDER BY day"
        )
        assert len(rows) >= 3
        first = rows[0]["moving_time_s"] / (rows[0]["distance_m"] / 1000)
        last = rows[-1]["moving_time_s"] / (rows[-1]["distance_m"] / 1000)
        assert last < first, "5 k pace should improve across the block"

    def test_races_are_never_short_of_their_nominal_distance(self, three_months):
        """A measured course is never short — and a short one breaks best-effort extraction."""
        for row in three_months.query(
            "SELECT activity_name, distance_m FROM activities "
            "WHERE activity_name IN ('parkrun 5 k', '10 k race', 'Half marathon')"
        ):
            nominal = {"parkrun 5 k": 5000.0, "10 k race": 10000.0,
                       "Half marathon": 21097.5}[row["activity_name"]]
            assert row["distance_m"] >= nominal
