"""Exclude-from-stats and the type override must reach every aggregate.

Found by the adversarial review pass of 2026-09-22 (docs/history/DECISIONS.md D43; the review
itself is in git history: `git show 0a9d297:REVIEW.md`). Every test here failed
against the code as first written.
"""

from __future__ import annotations

from datetime import date

import pytest

from odeda.analytics import load as load_mod
from odeda.analytics import performance as perf
from odeda.analytics import readiness as rdy
from odeda.analytics import reports as rep
from odeda.edits import overrides as ov


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
def two_runs(store):
    """A real run and a bogus one — the classic 'watch left running in the car'."""
    _add(store, "real", day="2026-09-10", distance_m=10000.0, trimp=100.0)
    _add(store, "bogus", day="2026-09-11", distance_m=90000.0, trimp=400.0,
         duration_s=9000.0, moving_time_s=9000.0, avg_speed_mps=10.0)
    return store


def test_excluded_activity_leaves_training_load_alone(two_runs):
    """CTL is driven by TRIMP; an excluded activity must not contribute any."""
    st = two_runs
    before = load_mod.compute_load(st)["current"]["ctl"]
    ov.set_override(st, "bogus", "excluded_from_stats", True)
    after = load_mod.compute_load(st)["current"]["ctl"]
    assert after < before, "excluded activity still counted toward CTL"


def test_excluded_activity_leaves_report_totals_alone(two_runs):
    st = two_runs
    ov.set_override(st, "bogus", "excluded_from_stats", True)
    totals = rep.compute_reports(st)["totals"]
    assert totals["activities"] == 1
    assert totals["total_km"] == pytest.approx(10.0, abs=0.1)
    assert totals["total_run_km"] == pytest.approx(10.0, abs=0.1)


def test_excluded_activity_leaves_weekly_running_volume_alone(two_runs):
    st = two_runs
    ov.set_override(st, "bogus", "excluded_from_stats", True)
    weeks = {w["week"]: w["km"] for w in rdy.weekly_distance(st)}
    assert 90.0 not in weeks.values()
    assert rdy.trailing_weekly_km(st, 28) == pytest.approx(10.0 / 4.0, abs=0.2)


def test_type_override_moves_an_activity_between_sport_totals(store):
    """Retyping a walk as a run must change the running totals everywhere."""
    _add(store, "mistyped", activity_type="walking", distance_m=8000.0)
    assert rep.compute_reports(store)["totals"]["total_run_km"] == 0
    ov.set_override(store, "mistyped", "activity_type", "running")
    assert rep.compute_reports(store)["totals"]["total_run_km"] == pytest.approx(8.0, abs=0.1)
    assert rdy.trailing_weekly_km(store, 7) > 0


def test_type_override_reaches_decoupling_history(store):
    """A long ride retyped as a run appears in the run-only decoupling list."""
    _add(store, "long", activity_type="cycling", duration_s=4000.0, moving_time_s=4000.0)
    store.upsert_many(
        "activity_samples",
        ["activity_id", "elapsed_s"],
        [
            {"activity_id": "long", "elapsed_s": float(i * 100),
             "distance_m": float(i * 300), "hr": 140.0 + i * 0.5}
            for i in range(0, 41)
        ],
    )
    store.conn.commit()
    assert perf.decoupling_history(store) == []
    ov.set_override(store, "long", "activity_type", "running")
    assert len(perf.decoupling_history(store)) == 1
