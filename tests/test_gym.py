"""Gym data read back from the raw activity payloads (`api/gym.py`).

Built from the handcrafted `fixtures.STRENGTH_ACTIVITY`, ingested the way the activity
sync ingests a list entry: archived raw first, then normalised with `raw_id` pointing
back at the archive.
"""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient

import fixtures as F
from garmin_analytics.api.gym import exercises_from_payload
from garmin_analytics.api.server import create_app
from garmin_analytics.db.store import Store
from garmin_analytics.ingest import normalize as N

GYM_ID = str(F.STRENGTH_ACTIVITY["activityId"])
RUN_ID = str(F.ACTIVITY["activityId"])
EXPORTED_ID = "444"

#: `STRENGTH_ACTIVITY`'s exercises as the API returns them: keys renamed, units and
#: int/float kept as Garmin sent them, and null where Garmin left a key out.
EXPECTED_EXERCISES = [
    {"index": 0, "category": "BENCH_PRESS", "sub_category": None, "sets": 3, "reps": 24,
     "max_weight_g": 50000, "volume_g": 1200000, "duration_ms": 150000.5},
    {"index": 1, "category": "DEADLIFT", "sub_category": "ROMANIAN_DEADLIFT", "sets": 2,
     "reps": 16, "max_weight_g": 60000, "volume_g": 960000, "duration_ms": 95000.0},
    {"index": 2, "category": "UNKNOWN", "sub_category": None, "sets": 1, "reps": 10,
     "max_weight_g": None, "volume_g": 0, "duration_ms": 30000.0},
]


def _ingest(st: Store, source: str, endpoint: str, ref_key: str, raw: Any,
            entry: dict[str, Any]) -> None:
    row = N.normalize_activity(entry)
    row["raw_id"] = st.store_raw(source, endpoint, ref_key, raw)
    st.upsert("activities", ["activity_id"], row)


@pytest.fixture
def client(settings):
    with Store.open(settings) as st, st.tx():
        for entry in (F.STRENGTH_ACTIVITY, F.ACTIVITY):
            _ingest(st, "connect", "activities", str(entry["activityId"]), entry, entry)
        # An export-zip activity points at the whole file it came from.
        exported = {**F.STRENGTH_ACTIVITY, "activityId": int(EXPORTED_ID),
                    "startTimeLocal": "2026-09-10 18:30:00"}
        _ingest(st, "export_zip", "document", "export.json",
                [{"summarizedActivitiesExport": [exported]}], exported)
    return TestClient(create_app(settings))


def _types_strictly(value: Any) -> Any:
    """The value with every leaf replaced by its type, so 1 and 1.0 compare unequal."""
    if isinstance(value, dict):
        return {k: _types_strictly(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_types_strictly(v) for v in value]
    return (type(value), value)


class TestExercisesEndpoint:
    def test_a_gym_session(self, client):
        res = client.get(f"/api/activities/{GYM_ID}/exercises")
        assert res.status_code == 200, res.text
        expected = {"total_sets": 6, "active_sets": 6, "total_reps": 50,
                    "exercises": EXPECTED_EXERCISES}
        assert _types_strictly(res.json()) == _types_strictly(expected)

    def test_an_activity_without_exercise_data_is_empty(self, client):
        body = client.get(f"/api/activities/{RUN_ID}/exercises").json()
        assert body == {"total_sets": None, "active_sets": None, "total_reps": None,
                        "exercises": []}

    def test_an_activity_inside_a_whole_export_file_has_none(self, client):
        body = client.get(f"/api/activities/{EXPORTED_ID}/exercises").json()
        assert body["exercises"] == [] and body["total_sets"] is None

    def test_unknown_activity(self, client):
        assert client.get("/api/activities/nope/exercises").status_code == 404


class TestTotalsOnActivityRows:
    def _totals(self, row: dict[str, Any]) -> tuple[Any, Any]:
        return row["total_sets"], row["total_reps"]

    def test_list(self, client):
        rows = {r["activity_id"]: r for r in client.get("/api/activities").json()["rows"]}
        assert self._totals(rows[GYM_ID]) == (6, 50)
        assert self._totals(rows[RUN_ID]) == (None, None)
        assert self._totals(rows[EXPORTED_ID]) == (None, None)

    @pytest.mark.parametrize("query", [
        "type=strength_training", "q=strength", "has_gps=false", "sort=day&order=asc",
        "start=2026-09-15", "edited=false",
    ])
    def test_list_filters_still_apply(self, client, query):
        body = client.get(f"/api/activities?{query}").json()
        gym = [r for r in body["rows"] if r["activity_id"] == GYM_ID]
        assert [self._totals(r) for r in gym] == [(6, 50)]

    def test_detail(self, client):
        act = client.get(f"/api/activities/{GYM_ID}").json()["activity"]
        assert self._totals(act) == (6, 50)
        run = client.get(f"/api/activities/{RUN_ID}").json()["activity"]
        assert self._totals(run) == (None, None)

    def test_edit_and_revert_responses_keep_them(self, client):
        res = client.patch(f"/api/activities/{GYM_ID}", json={"activity_name": "Legs"})
        assert res.status_code == 200, res.text
        assert self._totals(res.json()["activity"]) == (6, 50)
        field = client.delete(f"/api/activities/{GYM_ID}/overrides/activity_name").json()
        assert self._totals(field["activity"]) == (6, 50)
        every = client.delete(f"/api/activities/{GYM_ID}/overrides").json()
        assert self._totals(every["activity"]) == (6, 50)


class TestExercisesFromPayload:
    def test_index_is_the_payload_position_even_past_a_malformed_entry(self):
        body = exercises_from_payload({"summarizedExerciseSets": [
            "junk", {"category": "SQUAT", "sets": 4, "reps": 32}]})
        assert [(e["index"], e["category"]) for e in body["exercises"]] == [(1, "SQUAT")]

    @pytest.mark.parametrize("payload", [
        None, [], "text", {}, {"summarizedExerciseSets": None},
        {"summarizedExerciseSets": {"category": "SQUAT"}},
    ])
    def test_junk_is_empty(self, payload):
        assert exercises_from_payload(payload) == {
            "total_sets": None, "active_sets": None, "total_reps": None, "exercises": []}
