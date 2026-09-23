"""A bike ride is not a 5 k personal best.

Found by the adversarial review pass of 2026-09-22 (DECISIONS.md D43; the review
itself is in git history: `git show 0a9d297:REVIEW.md`). Every test here failed
against the code as first written.
"""

from __future__ import annotations

import pytest

from garmin_analytics.analytics import aggregate as agg
from garmin_analytics.analytics import performance as perf
from garmin_analytics.analytics import readiness as rdy
from garmin_analytics.edits import overrides as ov


def _add(store, activity_id: str, **kw):
    row = {
        "activity_id": activity_id,
        "day": "2026-09-10",
        "start_time_local": "2026-09-10 06:00:00",
        "activity_type": "running",
        "activity_name": "session",
        "distance_m": 10000.0,
        "duration_s": 3000.0,
        "moving_time_s": 3000.0,
        "avg_hr": 150.0,
        "avg_speed_mps": 10000.0 / 3000.0,
        "elevation_gain_m": 20.0,
        "calories": 600.0,
        "trimp": 100.0,
    }
    row.update(kw)
    store.upsert("activities", ["activity_id"], row)
    store.conn.commit()
    return row



@pytest.fixture
def run_and_ride(store):
    """A 25:00 5 k run and a 9:00 5 k ride, both with sample streams."""
    _add(store, "run", day="2026-09-01", activity_type="running")
    _add(store, "ride", day="2026-09-02", activity_type="cycling")
    for aid, s_per_100m in (("run", 30.0), ("ride", 10.8)):
        store.upsert_many(
            "activity_samples",
            ["activity_id", "elapsed_s"],
            [
                {"activity_id": aid, "elapsed_s": i * s_per_100m, "distance_m": float(i * 100)}
                for i in range(0, 61)
            ],
        )
    store.conn.commit()
    perf.rebuild_best_efforts(store)
    return store


def test_personal_bests_ignore_cycling(run_and_ride):
    best = {p["label"]: p for p in perf.personal_bests(run_and_ride)}
    assert best["5 k"]["activity_id"] == "run", "a bike ride was reported as a running PB"
    assert best["5 k"]["seconds"] == pytest.approx(1500.0, abs=1.0)


def test_records_wall_ignores_cycling_when_unfiltered(run_and_ride):
    wall = {r["label"]: r for r in agg.records(run_and_ride)["best_efforts"]}
    assert wall["5 k"]["activity_id"] == "run"


def test_records_wall_honours_an_explicit_cycling_filter(run_and_ride):
    wall = {r["label"]: r for r in agg.records(run_and_ride, activity_type="cycling")["best_efforts"]}
    assert wall["5 k"]["activity_id"] == "ride"


def test_race_projection_is_not_built_from_a_bike_ride(run_and_ride):
    """The Riegel projection must come off a run, not a 1:48/km 'half marathon'."""
    projection = rdy.compute_race(run_and_ride)["projection"]
    assert projection is not None
    assert projection["from_day"] == "2026-09-01", "projected off the ride, not the run"
    # A half marathon projected from a 25:00 5 k is slow; from a 9:00 bike 5 k it is
    # faster than the world record. Anything under 56 minutes is the bug.
    assert projection["projected_seconds"] > 56 * 60


def test_treadmill_runs_still_count_as_running_bests(store):
    _add(store, "tread", activity_type="treadmill_running")
    store.upsert_many(
        "activity_samples",
        ["activity_id", "elapsed_s"],
        [{"activity_id": "tread", "elapsed_s": i * 30.0, "distance_m": float(i * 100)}
         for i in range(0, 61)],
    )
    store.conn.commit()
    perf.rebuild_best_efforts(store)
    assert any(p["label"] == "5 k" for p in perf.personal_bests(store))


def test_excluded_activity_leaves_personal_bests_alone(store):
    """A 5 k 'PB' the user disowns must not survive being excluded.

    The fast activity runs at 0.18 s/m — 3:00/km: quicker than the honest one, and
    deliberately still under `MAX_PLAUSIBLE_SPEED_MPS`. It used to be 0.05 s/m
    (20 m/s, motorway speed), which `plausible_segments` now discards outright. That
    is a better outcome but a *different* defence; this test exists for the override
    mechanism, which has to keep working for efforts that are merely wrong rather than
    physically impossible.
    """
    _add(store, "honest", day="2026-09-01")
    _add(store, "car", day="2026-09-02")
    for aid, pace_s_per_m in (("honest", 0.30), ("car", 0.18)):
        store.upsert_many(
            "activity_samples",
            ["activity_id", "elapsed_s"],
            [
                {"activity_id": aid, "elapsed_s": i * 100 * pace_s_per_m,
                 "distance_m": float(i * 100)}
                for i in range(0, 61)
            ],
        )
    store.conn.commit()
    perf.rebuild_best_efforts(store)

    fast = [p for p in perf.personal_bests(store) if p["label"] == "5 k"][0]
    assert fast["activity_id"] == "car"

    ov.set_override(store, "car", "excluded_from_stats", True)
    honest = [p for p in perf.personal_bests(store) if p["label"] == "5 k"][0]
    assert honest["activity_id"] == "honest", "excluded activity still holds the PB"
