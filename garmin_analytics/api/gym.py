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
from collections.abc import Sequence
from datetime import date, timedelta
from typing import Any

from ..db.store import Store
from ..edits import exercises as relabels_mod

#: `race` as the API reports it: the user's flag if they set one, else Garmin's own
#: `eventType`, else 0. Garmin tagged 1 of ~487 activities as a race, so the user's
#: answer wins and the payload only fills in for activities they have not looked at.
#: Shared by `ROWS_SQL` and the list's `race` filter so the two cannot disagree.
RACE_SQL = (
    "COALESCE(v_activities.race, "
    "json_extract(raw.payload, '$.eventType.typeKey') = 'race', 0)"
)

#: The name `RACE_SQL` is selected under. The view already has a `race` column (the
#: raw override) and sqlite3.Row returns the first of two same-named columns, so the
#: resolved value needs a name of its own and `_resolved` puts it back.
_RACE_ALIAS = "effective_race"

#: Every `ActivityRow` the API returns: `v_activities` plus the set and rep totals and
#: the resolved race flag. `json_extract` keeps the activity list one query.
#: The join every one of those reads from. `raw.id` is a primary key, so the LEFT JOIN
#: can never multiply a row: `COUNT_SQL` counts activities, not payloads.
FROM_SQL = (
    "FROM v_activities LEFT JOIN raw_documents raw ON raw.id = v_activities.raw_id"
)

ROWS_SQL = (
    "SELECT v_activities.*, "
    "json_extract(raw.payload, '$.totalSets') AS total_sets, "
    "json_extract(raw.payload, '$.totalReps') AS total_reps, "
    f"{RACE_SQL} AS {_RACE_ALIAS} "
    f"{FROM_SQL}"
)

#: The matching count, for the list's `total`. Same FROM, so the same filters apply.
COUNT_SQL = f"SELECT COUNT(*) {FROM_SQL}"


def resolved(row: dict[str, Any]) -> dict[str, Any]:
    """A `ROWS_SQL` row as the API returns it: the resolved race flag under `race`."""
    out = dict(row)
    out["race"] = out.pop(_RACE_ALIAS)
    return out


def activity_rows(st: Store, where: str = "", params: Sequence[Any] = ()) -> list[dict[str, Any]]:
    """`ROWS_SQL` rows, resolved. `where` carries any clause and ORDER BY/LIMIT."""
    return [resolved(r) for r in st.query(f"{ROWS_SQL}{where}", params)]


def activity_row(st: Store, activity_id: str) -> dict[str, Any] | None:
    """One activity as `ActivityRow`: edits applied, gym totals and race attached."""
    rows = activity_rows(st, " WHERE v_activities.activity_id = ?", (activity_id,))
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
    return exercises_from_payload(
        json.loads(payload) if payload else None,
        relabels_mod.list_relabels(st, activity_id),
    )


def exercises_from_payload(
    payload: Any, relabels: dict[int, dict[str, Any]] | None = None
) -> dict[str, Any]:
    """Totals and exercises out of one raw activity payload, user relabels applied.

    `index` is the exercise's position in `summarizedExerciseSets`, counted before
    anything malformed is skipped, so it always points back at the same payload entry —
    and so a relabel keeps pointing at the exercise it was made on.

    A relabelled row carries the user's `category`/`sub_category`, `edited: true`, and
    Garmin's own guess in `garmin_category`/`garmin_sub_category`, which is what
    reverting brings back.
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
            _exercise(index, entry, (relabels or {}).get(index))
            for index, entry in enumerate(entries)
            if isinstance(entry, dict)
        ],
    }


def _exercise(
    index: int, entry: dict[str, Any], relabel: dict[str, Any] | None
) -> dict[str, Any]:
    garmin_category = entry.get("category")
    garmin_sub_category = entry.get("subCategory")
    category, sub_category = garmin_category, garmin_sub_category
    if relabel is not None:
        category, sub_category = relabels_mod.parse_label(relabel["value"])
    return {
        "index": index,
        "category": category,
        "sub_category": sub_category,
        "sets": entry.get("sets"),
        "reps": entry.get("reps"),
        "max_weight_g": entry.get("maxWeight"),
        "volume_g": entry.get("volume"),
        "duration_ms": entry.get("duration"),
        "edited": relabel is not None,
        "garmin_category": garmin_category,
        "garmin_sub_category": garmin_sub_category,
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
