"""Gym sessions and sets this week, for the Status page (`api/gym.gym_this_week`).

A handful of gym sessions built from `fixtures.STRENGTH_ACTIVITY`, placed on either
side of the ISO-week boundaries that matter. "Today" is pinned to Wednesday
2026-09-23, so the weeks are (Monday to Sunday):

    W39  09-21 .. 09-27   this week
    W38  09-14 .. 09-20   \
    W37  09-07 .. 09-13    | the four-week baseline
    W36  08-31 .. 09-06    |
    W35  08-24 .. 08-30   /
    W34  08-17 .. 08-23   in the eight-week window, not in the baseline
    W32  08-03 .. 08-09   first week of the eight-week window
    W31  07-27 .. 08-02   outside it
"""

from __future__ import annotations

from datetime import date
from typing import Any

import pytest
from fastapi.testclient import TestClient

import fixtures as F
from odeda.api import gym as gym_mod
from odeda.api.gym import gym_this_week
from odeda.api.server import create_app
from odeda.db.store import Store
from odeda.edits import overrides as ov_mod
from test_gym import _ingest

TODAY = date(2026, 9, 23)

#: (activity id, local start, totalSets). Every one is a gym session.
SESSIONS = [
    (1, "2026-09-21 00:10:00", 10),   # W39: Monday, just after midnight
    (2, "2026-09-23 18:30:00", 8),    # W39: today
    (3, "2026-09-20 23:30:00", 12),   # W38: Sunday, just before midnight
    (4, "2026-09-08 07:00:00", 8),    # W37
    (5, "2026-08-24 06:00:00", 4),    # W35: the baseline's first day
    (6, "2026-08-23 19:00:00", 20),   # W34: the day before the baseline
]

#: Not gym sessions, or not counted: a run this week, and a gym session this week
#: that the user excluded from stats.
RUN_THIS_WEEK = (7, "2026-09-22 06:00:00")
EXCLUDED = (8, "2026-09-22 18:00:00", 30)

#: Derivation:
#:   this week (W39): sessions 1, 2          -> 2 sessions, 10 + 8 = 18 sets
#:   baseline W35..W38: sessions 3, 4, 5     -> 3 / 4 = 0.75 sessions a week,
#:                      12 + 8 + 4 = 24 sets -> 24 / 4 = 6.0 sets a week
#:   session 6 (W34) is in neither; the run and the excluded session never count.
#:   sessions: (2 - 0.75) / 0.75 = 166.66... % -> 166.7
#:   sets:     (18 - 6) / 6      = 200 %
EXPECTED = {
    "week_start": "2026-09-21",
    "sessions": 2,
    "sets": 18,
    "avg_sessions": 0.75,
    "avg_sets": 6.0,
    "sessions_delta_pct": 166.7,
    "sets_delta_pct": 200.0,
}


def _gym(activity_id: int, start_local: str, total_sets: int) -> dict[str, Any]:
    return {**F.STRENGTH_ACTIVITY, "activityId": activity_id,
            "startTimeLocal": start_local, "totalSets": total_sets}


def _add(st: Store, entry: dict[str, Any]) -> None:
    _ingest(st, "connect", "activities", str(entry["activityId"]), entry, entry)


def _add_sessions(st: Store, sessions: list[tuple[int, str, int]]) -> None:
    with st.tx():
        for session in sessions:
            _add(st, _gym(*session))


@pytest.fixture
def week_store(store):
    _add_sessions(store, [*SESSIONS, EXCLUDED])
    with store.tx():
        run_id, run_start = RUN_THIS_WEEK
        _add(store, {**F.ACTIVITY, "activityId": run_id, "startTimeLocal": run_start})
        ov_mod.set_override(store, str(EXCLUDED[0]), "excluded_from_stats", True)
    return store


class TestGymThisWeek:
    def test_this_week_against_the_four_before(self, week_store):
        assert gym_this_week(week_store, TODAY) == EXPECTED

    def test_the_week_runs_monday_to_sunday(self, week_store):
        # Sunday 09-27 is still W39: nothing moves.
        assert gym_this_week(week_store, date(2026, 9, 27)) == EXPECTED

    def test_monday_starts_a_new_week(self, week_store):
        # Monday 09-28 is W40, with no sessions yet. The baseline becomes W36..W39:
        #   sessions 1, 2, 3, 4 -> 4 / 4 = 1.0 a week; 10 + 8 + 12 + 8 = 38 -> 9.5 sets
        #   0 against either is -100 %.
        assert gym_this_week(week_store, date(2026, 9, 28)) == {
            "week_start": "2026-09-28",
            "sessions": 0,
            "sets": 0,
            "avg_sessions": 1.0,
            "avg_sets": 9.5,
            "sessions_delta_pct": -100.0,
            "sets_delta_pct": -100.0,
        }


class TestHiddenWithoutRecentSessions:
    def test_an_empty_database(self, store):
        assert gym_this_week(store, TODAY) is None

    def test_only_activities_without_exercise_data(self, store):
        with store.tx():
            _add(store, F.ACTIVITY)
            _add(store, F.ACTIVITY_SPARSE)   # strength_training, but no sets recorded
        assert gym_this_week(store, TODAY) is None

    def test_last_session_the_day_before_the_eight_weeks(self, store):
        # Sunday 08-02 is W31, one day before the window's first Monday (08-03).
        _add_sessions(store, [(1, "2026-08-02 18:00:00", 12)])
        assert gym_this_week(store, TODAY) is None

    def test_last_session_on_the_first_day_of_the_eight_weeks(self, store):
        # Monday 08-03 (W32) is in the window but not in the baseline (W35..W38), so
        # it is shown with zeros and no delta: there is no baseline to compare with.
        _add_sessions(store, [(1, "2026-08-03 18:00:00", 12)])
        assert gym_this_week(store, TODAY) == {
            "week_start": "2026-09-21",
            "sessions": 0,
            "sets": 0,
            "avg_sessions": 0.0,
            "avg_sets": 0.0,
            "sessions_delta_pct": None,
            "sets_delta_pct": None,
        }

    def test_only_excluded_sessions(self, store):
        _add_sessions(store, [(1, "2026-09-22 18:00:00", 12)])
        with store.tx():
            ov_mod.set_override(store, "1", "excluded_from_stats", True)
        assert gym_this_week(store, TODAY) is None


class TestOnTheSummary:
    def test_summary_carries_it(self, settings, monkeypatch):
        with Store.open(settings) as st:
            _add_sessions(st, SESSIONS)
        monkeypatch.setattr(gym_mod, "_today", lambda: TODAY)
        body = TestClient(create_app(settings)).get("/api/summary").json()
        # Without the excluded session and the run, the numbers are unchanged.
        assert body["gym"] == EXPECTED

    def test_summary_is_null_without_gym_sessions(self, settings, monkeypatch):
        with Store.open(settings) as st, st.tx():
            _add(st, F.ACTIVITY)
        monkeypatch.setattr(gym_mod, "_today", lambda: TODAY)
        body = TestClient(create_app(settings)).get("/api/summary").json()
        assert body["gym"] is None
