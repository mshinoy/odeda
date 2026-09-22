"""Per-activity detail: the GPS / HR / cadence / altitude sample stream.

Garmin's activity-details endpoint returns a column-oriented payload: a list of
`metricDescriptors` naming each column, then one row per sample with a bare list of
numbers. Nothing is guaranteed to be present — an indoor run has no position, an
older device has no cadence — so the descriptor list is read first and every column
is looked up by name, never by index. A missing column yields None, not an exception.

This is the expensive half of a backfill: one request per activity, thousands of them
for a multi-year history. Everything here is therefore built to be resumable and to
archive the raw payload before touching it, so a re-parse never means a re-fetch.
"""

from __future__ import annotations

import logging
from typing import Any, Callable, Iterable, Sequence

log = logging.getLogger(__name__)

#: `maxChartSize` / `maxPolylineSize` cap how many samples Garmin returns. 2000 points
#: is roughly a sample every 3 seconds on a two-hour run — more resolution than any
#: of the analytics need, and it keeps a full backfill's payload sane.
DETAILS_PATH = (
    "/activity-service/activity/{activity_id}/details"
    "?maxChartSize={chart}&maxPolylineSize={poly}"
)
MAX_CHART = 2000
MAX_POLYLINE = 2000

#: Our column -> the Garmin metric keys that can supply it, in order of preference.
#: Garmin renamed several of these over the years and old activities keep the old
#: names, so each is a list rather than a single key.
COLUMN_SOURCES: dict[str, tuple[str, ...]] = {
    "elapsed_s": ("sumElapsedDuration", "sumDuration", "sumMovingDuration"),
    "distance_m": ("sumDistance",),
    "hr": ("directHeartRate",),
    "speed_mps": ("directSpeed", "weightedMeanSpeed"),
    "cadence_spm": ("directRunCadence", "directBikeCadence", "directDoubleCadence",
                    "directCadence"),
    "power_w": ("directPower",),
    "altitude_m": ("directElevation", "directAltitude"),
    "lat": ("directLatitude",),
    "lon": ("directLongitude",),
}

#: Latitude/longitude sanity bounds. Garmin occasionally emits a (0, 0) fix or a
#: semicircle-encoded value from a very old device; either would drag a route's
#: centroid into the Atlantic and wreck clustering.
_LAT_RANGE = (-90.0, 90.0)
_LON_RANGE = (-180.0, 180.0)


def _descriptor_index(payload: dict[str, Any]) -> dict[str, int]:
    """Map metric key -> column index, from `metricDescriptors`."""
    out: dict[str, int] = {}
    for desc in payload.get("metricDescriptors") or []:
        key = desc.get("key") or desc.get("metricsIndexKey")
        idx = desc.get("metricsIndex")
        if key is not None and idx is not None:
            out[str(key)] = int(idx)
    return out


def _column_map(payload: dict[str, Any]) -> dict[str, int]:
    """Resolve our column names to indices, using the first source that exists."""
    index = _descriptor_index(payload)
    resolved: dict[str, int] = {}
    for column, candidates in COLUMN_SOURCES.items():
        for key in candidates:
            if key in index:
                resolved[column] = index[key]
                break
    return resolved


def _value(row: Sequence[Any], idx: int | None) -> float | None:
    if idx is None or idx >= len(row):
        return None
    v = row[idx]
    if v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return None if f != f else f  # drop NaN


def _valid_position(lat: float | None, lon: float | None) -> bool:
    if lat is None or lon is None:
        return False
    if not (_LAT_RANGE[0] <= lat <= _LAT_RANGE[1]):
        return False
    if not (_LON_RANGE[0] <= lon <= _LON_RANGE[1]):
        return False
    # A null island fix is a dropout, not a location.
    return not (abs(lat) < 1e-6 and abs(lon) < 1e-6)


def normalize_details(payload: Any, activity_id: str) -> list[dict[str, Any]]:
    """Turn a details payload into `activity_samples` rows.

    Returns an empty list — not an error — when the activity has no stream at all,
    which is the normal case for strength sessions and some pool swims.
    """
    if not isinstance(payload, dict):
        return []
    metrics = payload.get("activityDetailMetrics") or []
    if not metrics:
        return []

    cols = _column_map(payload)
    rows: list[dict[str, Any]] = []
    prev_elapsed = -1.0

    for i, entry in enumerate(metrics):
        values = entry.get("metrics") if isinstance(entry, dict) else entry
        if not isinstance(values, (list, tuple)):
            continue

        elapsed = _value(values, cols.get("elapsed_s"))
        if elapsed is None:
            # No duration column: fall back to sample ordinal. Better than dropping
            # the stream, and the relative spacing is what the analytics use.
            elapsed = float(i)
        # `activity_samples` is keyed on (activity_id, elapsed_s); a duplicated or
        # non-monotonic timestamp would silently collapse samples together.
        if elapsed <= prev_elapsed:
            elapsed = prev_elapsed + 0.001
        prev_elapsed = elapsed

        lat = _value(values, cols.get("lat"))
        lon = _value(values, cols.get("lon"))
        if not _valid_position(lat, lon):
            lat = lon = None

        rows.append(
            {
                "activity_id": activity_id,
                "elapsed_s": round(elapsed, 3),
                "distance_m": _value(values, cols.get("distance_m")),
                "hr": _value(values, cols.get("hr")),
                "speed_mps": _value(values, cols.get("speed_mps")),
                "cadence_spm": _value(values, cols.get("cadence_spm")),
                "power_w": _value(values, cols.get("power_w")),
                "altitude_m": _value(values, cols.get("altitude_m")),
                "lat": None if lat is None else round(lat, 6),
                "lon": None if lon is None else round(lon, 6),
            }
        )
    return rows


def store_samples(store, activity_id: str, rows: Iterable[dict[str, Any]]) -> int:
    """Replace an activity's sample stream. Idempotent by construction."""
    rows = list(rows)
    if not rows:
        return 0
    with store.tx() as conn:
        conn.execute("DELETE FROM activity_samples WHERE activity_id = ?", (activity_id,))
        conn.executemany(
            "INSERT INTO activity_samples (activity_id, elapsed_s, distance_m, hr, "
            "speed_mps, cadence_spm, power_w, altitude_m, lat, lon) "
            "VALUES (:activity_id, :elapsed_s, :distance_m, :hr, :speed_mps, "
            ":cadence_spm, :power_w, :altitude_m, :lat, :lon)",
            rows,
        )
    return len(rows)


def fetch_details(
    activity_id: str,
    fetcher: Callable[[str], Any],
    chart: int = MAX_CHART,
    poly: int = MAX_POLYLINE,
) -> Any:
    return fetcher(
        DETAILS_PATH.format(activity_id=activity_id, chart=chart, poly=poly)
    )


def sync_activity_details(
    store,
    activity_id: str,
    fetcher: Callable[[str], Any],
    chart: int = MAX_CHART,
    poly: int = MAX_POLYLINE,
) -> dict[str, Any]:
    """Fetch, archive and normalise one activity's stream."""
    payload = fetch_details(activity_id, fetcher, chart, poly)
    if payload is None:
        return {"activity_id": activity_id, "samples": 0, "status": "empty"}

    store.store_raw("connect", "activity_details", activity_id, payload)
    rows = normalize_details(payload, activity_id)
    written = store_samples(store, activity_id, rows)
    has_gps = any(r["lat"] is not None for r in rows)
    return {
        "activity_id": activity_id,
        "samples": written,
        "gps": has_gps,
        "status": "ok" if written else "no_stream",
    }


def activities_missing_samples(store, limit: int | None = None) -> list[str]:
    """Activities whose stream has not been fetched yet — the backfill's work queue.

    Ordered oldest first so an interrupted backfill leaves a contiguous, usable
    history rather than a scattering of random days.
    """
    sql = (
        "SELECT a.activity_id FROM activities a "
        "WHERE NOT EXISTS (SELECT 1 FROM activity_samples s "
        "                  WHERE s.activity_id = a.activity_id) "
        "AND NOT EXISTS (SELECT 1 FROM raw_documents r "
        "                WHERE r.endpoint = 'activity_details' AND r.ref_key = a.activity_id) "
        "ORDER BY a.day, a.activity_id"
    )
    if limit:
        sql += f" LIMIT {int(limit)}"
    return [r["activity_id"] for r in store.query(sql)]


def reparse_details(store) -> dict[str, int]:
    """Re-normalise every archived details payload without re-fetching anything.

    This is what raw-first ingestion buys: when the parser improves, or a new column
    is added, the whole history can be rebuilt offline.
    """
    import json

    rows = store.query(
        "SELECT ref_key, payload FROM raw_documents WHERE endpoint = 'activity_details' "
        "ORDER BY id"
    )
    activities = samples = 0
    for row in rows:
        try:
            payload = json.loads(row["payload"])
        except (TypeError, ValueError):
            continue
        parsed = normalize_details(payload, row["ref_key"])
        if parsed:
            samples += store_samples(store, row["ref_key"], parsed)
            activities += 1
    return {"activities": activities, "samples": samples}
