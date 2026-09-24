"""Gym data, read back from the raw activity payloads at the response boundary.

Garmin's activity summaries carry `summarizedExerciseSets`, `totalSets`, `activeSets`
and `totalReps` for strength sessions (and some HIIT and yoga ones). Ingestion archives
them in `raw_documents` but never normalises them, so they are read here, straight from
the payload the activity row was built from (`activities.raw_id`). Units stay as
Garmin sends them: weights in grams, volume in grams x reps, durations in ms.

An activity imported from an export zip points at the whole file it came from, whose
top level holds no exercise keys, so it reads as having no exercise data. Picking its
entry out of the file is left undone: every synced activity has its own payload.
"""

from __future__ import annotations

import json
from typing import Any

from ..db.store import Store

#: Every `ActivityRow` the API returns: `v_activities` plus the set and rep totals.
#: `json_extract` keeps the activity list one query; both are null when absent.
ROWS_SQL = (
    "SELECT v_activities.*, "
    "json_extract(raw.payload, '$.totalSets') AS total_sets, "
    "json_extract(raw.payload, '$.totalReps') AS total_reps "
    "FROM v_activities "
    "LEFT JOIN raw_documents raw "
    "ON raw.id = v_activities.raw_id"
)


def activity_row(st: Store, activity_id: str) -> dict[str, Any] | None:
    """One activity as `ActivityRow`: edits applied, gym totals attached."""
    rows = st.query(f"{ROWS_SQL} WHERE v_activities.activity_id = ?", (activity_id,))
    return rows[0] if rows else None


def activity_exercises(st: Store, activity_id: str) -> dict[str, Any] | None:
    """The `ActivityExercises` body for one activity, or None when it doesn't exist."""
    rows = st.query(
        "SELECT raw.payload FROM v_activities "
        "LEFT JOIN raw_documents raw "
        "ON raw.id = v_activities.raw_id "
        "WHERE v_activities.activity_id = ?",
        (activity_id,),
    )
    if not rows:
        return None
    payload = rows[0]["payload"]
    return exercises_from_payload(json.loads(payload) if payload else None)


def exercises_from_payload(payload: Any) -> dict[str, Any]:
    """Totals and exercises out of one raw activity payload.

    `index` is the exercise's position in `summarizedExerciseSets`, counted before
    anything malformed is skipped, so it always points back at the same payload entry.
    """
    if not isinstance(payload, dict):
        payload = {}
    entries = payload.get("summarizedExerciseSets")
    if not isinstance(entries, list):
        entries = []
    return {
        "total_sets": payload.get("totalSets"),
        "active_sets": payload.get("activeSets"),
        "total_reps": payload.get("totalReps"),
        "exercises": [
            {
                "index": index,
                "category": entry.get("category"),
                "sub_category": entry.get("subCategory"),
                "sets": entry.get("sets"),
                "reps": entry.get("reps"),
                "max_weight_g": entry.get("maxWeight"),
                "volume_g": entry.get("volume"),
                "duration_ms": entry.get("duration"),
            }
            for index, entry in enumerate(entries)
            if isinstance(entry, dict)
        ],
    }
