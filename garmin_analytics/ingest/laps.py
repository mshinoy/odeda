"""The watch's own laps: what Garmin Connect lists under an activity's "Laps" tab.

`/activity-service/activity/{id}/splits` returns one `lapDTO` per lap. When the run was
a structured workout, each lap is one workout step and carries the step's
`intensityType` (WARMUP, ACTIVE, REST, ...), so a 4 min run / 1 min walk session comes
back as the intervals the watch actually timed, with Garmin's own HR, pace and cadence
for each. Nothing here has to infer an interval from the sample stream.

When the laps show a workout was followed, `/activity-service/activity/{id}/workouts`
gives its plan: each step's planned time or distance and its target (a pace range, a
cadence range, a heart-rate zone). Laps point at plan steps by `wktStepIndex`, which is
what lets a step be judged against its own target.

Raw-first like everything else: the payloads are archived before they are parsed, and
`reparse_laps` rebuilds both tables from the archive without a request.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any, Callable, Iterable

log = logging.getLogger(__name__)

LAPS_PATH = "/activity-service/activity/{activity_id}/splits"
ENDPOINT = "activity_laps"
WORKOUT_PATH = "/activity-service/activity/{activity_id}/workouts"
WORKOUT_ENDPOINT = "activity_workout"


def _num(v: Any) -> float | None:
    if v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return None if f != f else f  # drop NaN


def _gmt(stamp: Any) -> datetime | None:
    """Garmin's `2026-11-11T18:52:22.0` and our `2026-11-11T18:49:58Z`, both UTC."""
    if not isinstance(stamp, str) or not stamp:
        return None
    text = stamp.rstrip("Z").split(".")[0]
    try:
        return datetime.fromisoformat(text).replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def normalize_laps(
    payload: Any, activity_id: str, start_utc: str | None
) -> list[dict[str, Any]]:
    """Turn a /splits payload into `activity_laps` rows, ordered by lap.

    `start_utc` is the activity's own start; each lap's offset is measured from it so
    the lap lines up with the sample stream. Without it the offset is the running sum
    of lap durations, which is right unless the watch was paused between laps.
    """
    if not isinstance(payload, dict):
        return []
    laps = payload.get("lapDTOs") or []
    t0 = _gmt(start_utc)
    rows: list[dict[str, Any]] = []
    running = 0.0
    for i, lap in enumerate(laps):
        if not isinstance(lap, dict):
            continue
        duration = _num(lap.get("duration")) or _num(lap.get("elapsedDuration"))
        started = _gmt(lap.get("startTimeGMT"))
        offset = (started - t0).total_seconds() if (started and t0) else running
        running = offset + (duration or 0.0)
        intensity = lap.get("intensityType")
        rows.append(
            {
                "activity_id": activity_id,
                "lap_index": int(lap.get("lapIndex") or i + 1),
                "start_offset_s": round(offset, 3),
                "duration_s": duration,
                "distance_m": _num(lap.get("distance")),
                "intensity": str(intensity).upper() if intensity else None,
                "wkt_step_index": (
                    int(lap["wktStepIndex"]) if lap.get("wktStepIndex") is not None else None
                ),
                "avg_hr": _num(lap.get("averageHR")),
                "max_hr": _num(lap.get("maxHR")),
                "avg_speed_mps": _num(lap.get("averageSpeed")),
                "avg_cadence_spm": _num(lap.get("averageRunCadence")),
                "elevation_gain_m": _num(lap.get("elevationGain")),
            }
        )
    return rows


def normalize_workout(payload: Any, activity_id: str) -> list[dict[str, Any]]:
    """Turn a /workouts payload (a list of workouts) into `activity_workout_steps` rows."""
    if not isinstance(payload, list):
        return []
    rows: list[dict[str, Any]] = []
    for w_i, workout in enumerate(payload):
        if not isinstance(workout, dict):
            continue
        w_index = int(workout.get("index") if workout.get("index") is not None else w_i)
        for s_i, step in enumerate(workout.get("steps") or []):
            if not isinstance(step, dict):
                continue
            intensity = step.get("intensity")
            target = step.get("targetType")
            rows.append(
                {
                    "activity_id": activity_id,
                    "workout_index": w_index,
                    "step_index": int(
                        step["stepIndex"] if step.get("stepIndex") is not None else s_i
                    ),
                    "intensity": str(intensity).upper() if intensity else None,
                    "duration_type": step.get("durationType"),
                    "duration_value": _num(step.get("durationValue")),
                    "target_type": str(target).upper() if target else None,
                    "target_value": _num(step.get("targetValue")),
                    "target_low": _num(step.get("targetValueLow")),
                    "target_high": _num(step.get("targetValueHigh")),
                }
            )
    return rows


def store_workout(store, activity_id: str, rows: Iterable[dict[str, Any]]) -> int:
    """Replace an activity's workout plan. Idempotent by construction."""
    rows = list(rows)
    with store.tx() as conn:
        conn.execute("DELETE FROM activity_workout_steps WHERE activity_id = ?", (activity_id,))
        conn.executemany(
            "INSERT OR REPLACE INTO activity_workout_steps (activity_id, workout_index, "
            "step_index, intensity, duration_type, duration_value, target_type, "
            "target_value, target_low, target_high) VALUES (:activity_id, :workout_index, "
            ":step_index, :intensity, :duration_type, :duration_value, :target_type, "
            ":target_value, :target_low, :target_high)",
            rows,
        )
    return len(rows)


def sync_activity_workout(
    store, activity_id: str, fetcher: Callable[[str], Any]
) -> dict[str, Any]:
    """Fetch, archive and normalise the workout plan one activity followed."""
    payload = fetcher(WORKOUT_PATH.format(activity_id=activity_id))
    store.store_raw(
        "connect", WORKOUT_ENDPOINT, activity_id, payload if payload is not None else []
    )
    written = store_workout(store, activity_id, normalize_workout(payload, activity_id))
    return {"activity_id": activity_id, "workout_steps": written}


def store_laps(store, activity_id: str, rows: Iterable[dict[str, Any]]) -> int:
    """Replace an activity's laps. Idempotent by construction."""
    rows = list(rows)
    with store.tx() as conn:
        conn.execute("DELETE FROM activity_laps WHERE activity_id = ?", (activity_id,))
        conn.executemany(
            "INSERT INTO activity_laps (activity_id, lap_index, start_offset_s, duration_s, "
            "distance_m, intensity, wkt_step_index, avg_hr, max_hr, avg_speed_mps, "
            "avg_cadence_spm, elevation_gain_m) VALUES (:activity_id, :lap_index, "
            ":start_offset_s, :duration_s, :distance_m, :intensity, :wkt_step_index, "
            ":avg_hr, :max_hr, :avg_speed_mps, :avg_cadence_spm, :elevation_gain_m)",
            rows,
        )
    return len(rows)


def _start_utc(store, activity_id: str) -> str | None:
    return store.scalar(
        "SELECT start_time_utc FROM activities WHERE activity_id = ?", (activity_id,)
    )


def sync_activity_laps(
    store, activity_id: str, fetcher: Callable[[str], Any]
) -> dict[str, Any]:
    """Fetch, archive and normalise one activity's laps, and its plan if it had one."""
    payload = fetcher(LAPS_PATH.format(activity_id=activity_id))
    # Archived even when empty, so the queue below does not ask again.
    store.store_raw("connect", ENDPOINT, activity_id, payload if payload is not None else {})
    rows = normalize_laps(payload, activity_id, _start_utc(store, activity_id))
    written = store_laps(store, activity_id, rows)
    out: dict[str, Any] = {"activity_id": activity_id, "laps": written}
    # Only a run that followed a workout has a plan to fetch: one more request, not one
    # per activity.
    if any(r["wkt_step_index"] is not None for r in rows):
        out["workout_steps"] = sync_activity_workout(store, activity_id, fetcher)[
            "workout_steps"
        ]
    return out


def activities_missing_laps(store, limit: int | None = None) -> list[str]:
    """Activities with a sample stream whose laps have not been fetched yet.

    Newest first: the run you did last night matters more than one from 2023, and the
    automatic sync only takes a few per run.
    """
    sql = (
        "SELECT a.activity_id FROM activities a "
        "WHERE EXISTS (SELECT 1 FROM activity_samples s WHERE s.activity_id = a.activity_id) "
        "AND NOT EXISTS (SELECT 1 FROM raw_documents r "
        "                WHERE r.endpoint = ? AND r.ref_key = a.activity_id) "
        "ORDER BY a.start_time_utc DESC, a.activity_id DESC"
    )
    if limit:
        sql += f" LIMIT {int(limit)}"
    return [r["activity_id"] for r in store.query(sql, (ENDPOINT,))]


def activities_missing_workout(store, limit: int | None = None) -> list[str]:
    """Activities whose laps show a workout but whose plan has not been fetched yet.

    Laps fetched before plans were (the first build of this) land here; so does any run
    whose plan request failed. Newest first, like the laps.
    """
    sql = (
        "SELECT a.activity_id FROM activities a "
        "WHERE EXISTS (SELECT 1 FROM activity_laps l "
        "              WHERE l.activity_id = a.activity_id AND l.wkt_step_index IS NOT NULL) "
        "AND NOT EXISTS (SELECT 1 FROM raw_documents r "
        "                WHERE r.endpoint = ? AND r.ref_key = a.activity_id) "
        "ORDER BY a.start_time_utc DESC, a.activity_id DESC"
    )
    if limit:
        sql += f" LIMIT {int(limit)}"
    return [r["activity_id"] for r in store.query(sql, (WORKOUT_ENDPOINT,))]


def reparse_laps(store) -> dict[str, int]:
    """Re-normalise every archived laps payload without re-fetching anything."""
    rows = store.query(
        "SELECT ref_key, payload FROM raw_documents WHERE endpoint = ? ORDER BY id",
        (ENDPOINT,),
    )
    activities = laps = 0
    for row in rows:
        try:
            payload = json.loads(row["payload"])
        except (TypeError, ValueError):
            continue
        aid = row["ref_key"]
        laps += store_laps(store, aid, normalize_laps(payload, aid, _start_utc(store, aid)))
        activities += 1
    steps = 0
    for row in store.query(
        "SELECT ref_key, payload FROM raw_documents WHERE endpoint = ? ORDER BY id",
        (WORKOUT_ENDPOINT,),
    ):
        try:
            payload = json.loads(row["payload"])
        except (TypeError, ValueError):
            continue
        steps += store_workout(store, row["ref_key"], normalize_workout(payload, row["ref_key"]))
    return {"activities": activities, "laps": laps, "workout_steps": steps}
