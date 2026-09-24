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
from datetime import date, timedelta
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


# ---------------------------------------------------------------------------
# Gym this week (the Status page)
# ---------------------------------------------------------------------------

#: The baseline a week is compared against: the mean of the weeks just before it.
BASELINE_WEEKS = 4
#: With no gym session in this many weeks (this one included), there is nothing to show.
SHOWN_WITHIN_WEEKS = 8


def _today() -> date:
    """The server's local date, as `compute_race` and the streaks use. A function so
    tests can pin it."""
    return date.today()


def week_monday(day: date) -> date:
    """The Monday that starts `day`'s ISO week: the week `load.weekly_loads` (the
    Status page's weekly load chart) and `reports.weekly_report` bucket by."""
    return day - timedelta(days=day.weekday())


def gym_this_week(st: Store, today: date | None = None) -> dict[str, Any] | None:
    """`GymThisWeek`: gym sessions and sets in the ISO week holding `today`, against
    the mean of the four weeks before it. None when the last eight weeks (this one
    included) hold no gym session.

    A gym session is an activity with exercise data (`totalSets` in its payload), not
    a `strength_training` type: HIIT and yoga sessions with sets count, as they do on
    the activity list. Excluded-from-stats activities do not count, as for every
    other statistic. Weeks go by the activity's local `day`.
    """
    this_monday = week_monday(today or _today())
    first_monday = this_monday - timedelta(weeks=SHOWN_WITHIN_WEEKS - 1)
    last_sunday = this_monday + timedelta(days=6)
    rows = st.query(
        "SELECT v.day, json_extract(raw.payload, '$.totalSets') AS total_sets "
        "FROM v_activities_included v "
        "JOIN raw_documents raw ON raw.id = v.raw_id "
        "WHERE v.day BETWEEN ? AND ? "
        "AND json_extract(raw.payload, '$.totalSets') IS NOT NULL",
        (first_monday.isoformat(), last_sunday.isoformat()),
    )
    if not rows:
        return None

    sessions: dict[date, int] = {}
    sets: dict[date, int] = {}
    for row in rows:
        monday = week_monday(date.fromisoformat(row["day"]))
        sessions[monday] = sessions.get(monday, 0) + 1
        sets[monday] = sets.get(monday, 0) + int(row["total_sets"])

    baseline = [this_monday - timedelta(weeks=n) for n in range(1, BASELINE_WEEKS + 1)]
    avg_sessions = sum(sessions.get(m, 0) for m in baseline) / BASELINE_WEEKS
    avg_sets = sum(sets.get(m, 0) for m in baseline) / BASELINE_WEEKS
    week_sessions = sessions.get(this_monday, 0)
    week_sets = sets.get(this_monday, 0)
    return {
        "week_start": this_monday.isoformat(),
        "sessions": week_sessions,
        "sets": week_sets,
        "avg_sessions": avg_sessions,
        "avg_sets": avg_sets,
        "sessions_delta_pct": _delta_pct(week_sessions, avg_sessions),
        "sets_delta_pct": _delta_pct(week_sets, avg_sets),
    }


def _delta_pct(value: float, baseline: float) -> float | None:
    """Percent change from `baseline`; None off a zero baseline, where it has no size."""
    if baseline <= 0:
        return None
    return round((value - baseline) / baseline * 100.0, 1)
