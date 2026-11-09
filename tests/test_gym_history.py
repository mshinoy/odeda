"""What each exercise of a gym session was the last time (`gym.exercise_history`)."""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient

import fixtures as F
from garmin_analytics.api.gym import exercise_history
from garmin_analytics.api.server import create_app
from garmin_analytics.db.store import Store
from garmin_analytics.edits import exercises as relabels_mod
from garmin_analytics.ingest import normalize as N


def session(activity_id: int, day: str, exercises: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        **F.STRENGTH_ACTIVITY,
        "activityId": activity_id,
        "startTimeLocal": f"{day} 18:30:00",
        "startTimeGMT": f"{day} 15:30:00",
        "totalSets": sum(e["sets"] for e in exercises),
        "totalReps": sum(e["reps"] for e in exercises),
        "summarizedExerciseSets": exercises,
    }


def bench(kg: float, sets: int = 3, reps: int = 24) -> dict[str, Any]:
    return {"category": "BENCH_PRESS", "sets": sets, "reps": reps,
            "maxWeight": kg * 1000, "volume": kg * 1000 * reps, "duration": 1000.0}


def squat(kg: float) -> dict[str, Any]:
    return {"category": "SQUAT", "sets": 3, "reps": 21, "maxWeight": kg * 1000,
            "volume": kg * 1000 * 21, "duration": 1000.0}


def unnamed(kg: float = 20) -> dict[str, Any]:
    return {"category": "UNKNOWN", "sets": 3, "reps": 20, "maxWeight": kg * 1000,
            "volume": kg * 1000 * 20, "duration": 1000.0}


def ingest(st: Store, entry: dict[str, Any]) -> str:
    row = N.normalize_activity(entry)
    row["raw_id"] = st.store_raw("connect", "activities", str(entry["activityId"]), entry)
    st.upsert("activities", ["activity_id"], row)
    return str(entry["activityId"])


@pytest.fixture
def st(settings):
    with Store.open(settings) as store:
        yield store


class TestExerciseHistory:
    def test_each_exercise_says_what_it_was_the_last_time(self, st):
        with st.tx():
            ingest(st, session(1, "2026-07-06", [bench(44), squat(80)]))
            ingest(st, session(2, "2026-09-03", [bench(55), squat(80)]))
        out = exercise_history(st, "2")
        bench_last = out["exercises"][0]["last"]
        assert bench_last["day"] == "2026-07-06"
        assert bench_last["max_weight_g"] == 44000
        assert out["exercises"][1]["last"]["max_weight_g"] == 80000

    def test_the_most_recent_earlier_time_wins_even_across_sessions_without_it(self, st):
        with st.tx():
            ingest(st, session(1, "2026-06-01", [bench(40)]))
            ingest(st, session(2, "2026-07-01", [bench(44)]))
            ingest(st, session(3, "2026-08-01", [squat(80)]))  # no bench this time
            ingest(st, session(4, "2026-09-01", [bench(55)]))
        last = exercise_history(st, "4")["exercises"][0]["last"]
        assert last["day"] == "2026-07-01" and last["max_weight_g"] == 44000

    def test_a_first_time_has_no_last(self, st):
        with st.tx():
            ingest(st, session(1, "2026-07-06", [squat(80)]))
            ingest(st, session(2, "2026-09-03", [bench(55)]))
        assert exercise_history(st, "2")["exercises"][0]["last"] is None

    def test_an_exercise_garmin_could_not_name_has_no_history(self, st):
        """UNKNOWN is a pile of different movements: comparing them would be a lie."""
        with st.tx():
            ingest(st, session(1, "2026-07-06", [unnamed(20)]))
            ingest(st, session(2, "2026-09-03", [unnamed(30)]))
        assert exercise_history(st, "2")["exercises"][0]["last"] is None

    def test_naming_an_exercise_gives_it_a_history(self, st):
        with st.tx():
            ingest(st, session(1, "2026-07-06", [bench(44)]))
            ingest(st, session(2, "2026-09-03", [unnamed(50)]))
        relabels_mod.set_relabel(st, "2", 0, "BENCH_PRESS", "UNKNOWN")
        last = exercise_history(st, "2")["exercises"][0]["last"]
        assert last is not None and last["max_weight_g"] == 44000

    def test_a_relabel_on_the_earlier_session_counts_too(self, st):
        with st.tx():
            ingest(st, session(1, "2026-07-06", [unnamed(44)]))
            ingest(st, session(2, "2026-09-03", [bench(55)]))
        relabels_mod.set_relabel(st, "1", 0, "BENCH_PRESS", "UNKNOWN")
        assert exercise_history(st, "2")["exercises"][0]["last"]["day"] == "2026-07-06"

    def test_a_later_session_is_not_last_time(self, st):
        with st.tx():
            ingest(st, session(1, "2026-09-03", [bench(55)]))
            ingest(st, session(2, "2026-10-01", [bench(60)]))
        assert exercise_history(st, "1")["exercises"][0]["last"] is None

    def test_the_session_before_gives_a_total_to_compare_against(self, st):
        with st.tx():
            ingest(st, session(1, "2026-07-06", [bench(44), squat(80)]))
            ingest(st, session(2, "2026-09-03", [bench(55)]))
        previous = exercise_history(st, "2")["previous"]
        assert previous["day"] == "2026-07-06"
        assert previous["volume_g"] == 44000 * 24 + 80000 * 21
        assert previous["sets"] == 6

    def test_the_first_session_ever_has_nothing_before_it(self, st):
        with st.tx():
            ingest(st, session(1, "2026-07-06", [bench(44)]))
        out = exercise_history(st, "1")
        assert out["previous"] is None and out["exercises"][0]["last"] is None

    def test_not_a_gym_session_has_no_history(self, st):
        with st.tx():
            ingest(st, F.ACTIVITY)
        out = exercise_history(st, str(F.ACTIVITY["activityId"]))
        assert out is None or out["exercises"] == []


class TestEndpoint:
    @pytest.fixture
    def client(self, settings):
        with Store.open(settings) as store, store.tx():
            ingest(store, session(1, "2026-07-06", [bench(44)]))
            ingest(store, session(2, "2026-09-03", [bench(55)]))
            ingest(store, F.ACTIVITY)
        return TestClient(create_app(settings))

    def test_the_history_of_a_session(self, client):
        body = client.get("/api/activities/2/exercise-history").json()
        assert body["exercises"][0]["last"]["max_weight_g"] == 44000
        assert body["previous"]["day"] == "2026-07-06"

    def test_an_unknown_activity_is_a_404(self, client):
        assert client.get("/api/activities/nope/exercise-history").status_code == 404

    def test_a_run_has_no_exercises_to_compare(self, client):
        run = str(F.ACTIVITY["activityId"])
        response = client.get(f"/api/activities/{run}/exercise-history")
        assert response.status_code == 200
        assert response.json()["exercises"] == []
