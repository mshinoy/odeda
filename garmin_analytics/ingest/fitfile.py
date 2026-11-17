"""FIT file parsing via `fitdecode`.

Split deliberately in two:

  * `parse_frames()` is pure — it takes anything that quacks like a fitdecode frame and
    returns plain dicts. That is what the unit tests exercise directly.
  * `read_fit()` opens a real file and feeds `parse_frames()`.

FIT is where the per-second detail lives (HR, pace, cadence, power, altitude), so this
is the path that makes best-effort extraction and aerobic decoupling accurate. The
Connect activity list only has summaries.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Mapping

from . import normalize as norm

log = logging.getLogger("garmin_analytics.fit")

RESAMPLE_INTERVAL_S = 10  # see docs/history/DECISIONS.md D14

# FIT `sport` enum -> our coarse activity types.
SPORT_MAP = {
    "running": "running",
    "cycling": "cycling",
    "swimming": "swimming",
    "walking": "walking",
    "training": "strength_training",
    "fitness_equipment": "other",
    "generic": "other",
}


def _get(frame: Any, name: str) -> Any:
    """Read a field from a fitdecode frame, tolerating absent fields."""
    try:
        if hasattr(frame, "has_field") and not frame.has_field(name):
            return None
        return frame.get_value(name, fallback=None)
    except (KeyError, TypeError, ValueError):
        return None


def _to_epoch(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        dt = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
        return dt.timestamp()
    return norm.as_float(value)


def parse_frames(frames: Iterable[Any]) -> dict[str, Any]:
    """Turn a FIT frame stream into {'session': {...}, 'records': [...]}.

    Only data frames named `record`, `session`, `sport` or `file_id` are used; anything
    else is ignored but is *not* an error — FIT files carry dozens of message types and
    new ones appear with every firmware.
    """
    records: list[dict[str, Any]] = []
    session: dict[str, Any] = {}
    file_id: dict[str, Any] = {}
    sport: str | None = None

    for frame in frames:
        name = getattr(frame, "name", None)
        if name == "record":
            ts = _to_epoch(_get(frame, "timestamp"))
            if ts is None:
                continue
            speed = norm.as_float(_get(frame, "enhanced_speed"))
            if speed is None:
                speed = norm.as_float(_get(frame, "speed"))
            alt = norm.as_float(_get(frame, "enhanced_altitude"))
            if alt is None:
                alt = norm.as_float(_get(frame, "altitude"))
            records.append(
                {
                    "timestamp": ts,
                    "distance_m": norm.as_float(_get(frame, "distance")),
                    "hr": norm.as_float(_get(frame, "heart_rate")),
                    "speed_mps": speed,
                    "cadence_spm": norm.as_float(_get(frame, "cadence")),
                    "power_w": norm.as_float(_get(frame, "power")),
                    "altitude_m": alt,
                }
            )
        elif name == "session":
            start = _to_epoch(_get(frame, "start_time"))
            session = {
                "start_epoch": start,
                "sport": _get(frame, "sport"),
                "total_distance_m": norm.as_float(_get(frame, "total_distance")),
                "total_elapsed_s": norm.as_float(_get(frame, "total_elapsed_time")),
                "total_timer_s": norm.as_float(_get(frame, "total_timer_time")),
                "avg_hr": norm.as_float(_get(frame, "avg_heart_rate")),
                "max_hr": norm.as_float(_get(frame, "max_heart_rate")),
                "avg_speed_mps": norm.as_float(_get(frame, "enhanced_avg_speed"))
                or norm.as_float(_get(frame, "avg_speed")),
                "max_speed_mps": norm.as_float(_get(frame, "enhanced_max_speed"))
                or norm.as_float(_get(frame, "max_speed")),
                "total_ascent_m": norm.as_float(_get(frame, "total_ascent")),
                "calories": norm.as_float(_get(frame, "total_calories")),
                "avg_cadence_spm": norm.as_float(_get(frame, "avg_cadence")),
                "avg_power_w": norm.as_float(_get(frame, "avg_power")),
            }
        elif name == "sport":
            sport = _get(frame, "sport")
        elif name == "file_id":
            file_id = {
                "manufacturer": _get(frame, "manufacturer"),
                "product": _get(frame, "product"),
                "serial_number": _get(frame, "serial_number"),
                "time_created": _to_epoch(_get(frame, "time_created")),
            }

    records.sort(key=lambda r: r["timestamp"])
    if session.get("sport") is None and sport is not None:
        session["sport"] = sport
    return {"session": session, "records": records, "file_id": file_id}


def to_activity(
    parsed: Mapping[str, Any],
    activity_id: str,
    tz_offset_hours: float = 0.0,
) -> dict[str, Any] | None:
    """Build an `activities` row from a parsed FIT file.

    Falls back to the record stream for anything the session message omits — cheap
    watches and third-party exports routinely drop session fields.
    """
    records = parsed.get("records") or []
    session = dict(parsed.get("session") or {})
    if not records and not session:
        return None

    start = session.get("start_epoch")
    if start is None and records:
        start = records[0]["timestamp"]
    if start is None:
        return None

    elapsed = session.get("total_elapsed_s")
    if elapsed is None and records:
        elapsed = records[-1]["timestamp"] - records[0]["timestamp"]
    moving = session.get("total_timer_s") or elapsed

    dist = session.get("total_distance_m")
    if dist is None:
        dists = [r["distance_m"] for r in records if r["distance_m"] is not None]
        dist = (max(dists) - min(dists)) if len(dists) >= 2 else None

    hrs = [r["hr"] for r in records if r["hr"] is not None]
    avg_hr = session.get("avg_hr") or (sum(hrs) / len(hrs) if hrs else None)
    max_hr = session.get("max_hr") or (max(hrs) if hrs else None)

    avg_speed = session.get("avg_speed_mps")
    if avg_speed is None and dist and moving:
        avg_speed = dist / moving

    speeds = [r["speed_mps"] for r in records if r["speed_mps"] is not None]
    cadences = [r["cadence_spm"] for r in records if r["cadence_spm"] is not None]
    powers = [r["power_w"] for r in records if r["power_w"] is not None]

    gain = session.get("total_ascent_m")
    if gain is None:
        alts = [r["altitude_m"] for r in records if r["altitude_m"] is not None]
        gain = sum(max(0.0, b - a) for a, b in zip(alts, alts[1:])) if len(alts) >= 2 else None

    start_dt = datetime.fromtimestamp(start, tz=timezone.utc)
    local_dt = datetime.fromtimestamp(start + tz_offset_hours * 3600.0, tz=timezone.utc)
    sport_key = str(session.get("sport") or "generic")

    return {
        "activity_id": activity_id,
        "day": local_dt.strftime("%Y-%m-%d"),
        "start_time_local": local_dt.strftime("%Y-%m-%dT%H:%M:%S"),
        "start_time_utc": start_dt.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "activity_type": SPORT_MAP.get(sport_key, "other"),
        "activity_name": None,
        "distance_m": dist,
        "duration_s": elapsed,
        "moving_time_s": moving,
        "avg_hr": avg_hr,
        "max_hr": max_hr,
        "avg_speed_mps": avg_speed,
        "max_speed_mps": session.get("max_speed_mps") or (max(speeds) if speeds else None),
        "elevation_gain_m": gain,
        "calories": session.get("calories"),
        "avg_cadence_spm": session.get("avg_cadence_spm")
        or (sum(cadences) / len(cadences) if cadences else None),
        "avg_power_w": session.get("avg_power_w") or (sum(powers) / len(powers) if powers else None),
        "training_effect_aerobic": None,
        "training_effect_anaerobic": None,
    }


def to_samples(
    parsed: Mapping[str, Any],
    activity_id: str,
    interval_s: int = RESAMPLE_INTERVAL_S,
) -> list[dict[str, Any]]:
    """Downsample the record stream to one row per `interval_s` of elapsed time.

    Nearest-sample selection, not interpolation: a real 1 Hz stream has gaps (tunnels,
    auto-pause) and interpolating across them would invent distance that was not run.
    """
    records = parsed.get("records") or []
    if not records:
        return []
    t0 = records[0]["timestamp"]
    out: list[dict[str, Any]] = []
    next_mark = 0.0
    for r in records:
        elapsed = r["timestamp"] - t0
        if elapsed + 1e-9 < next_mark:
            continue
        out.append(
            {
                "activity_id": activity_id,
                "elapsed_s": round(elapsed, 1),
                "distance_m": r["distance_m"],
                "hr": r["hr"],
                "speed_mps": r["speed_mps"],
                "cadence_spm": r["cadence_spm"],
                "power_w": r["power_w"],
                "altitude_m": r["altitude_m"],
            }
        )
        next_mark = elapsed + interval_s
    # Always keep the final sample: it carries the total distance.
    last_elapsed = round(records[-1]["timestamp"] - t0, 1)
    if out and out[-1]["elapsed_s"] != last_elapsed:
        r = records[-1]
        out.append(
            {
                "activity_id": activity_id,
                "elapsed_s": last_elapsed,
                "distance_m": r["distance_m"],
                "hr": r["hr"],
                "speed_mps": r["speed_mps"],
                "cadence_spm": r["cadence_spm"],
                "power_w": r["power_w"],
                "altitude_m": r["altitude_m"],
            }
        )
    return out


def hr_zone_seconds(
    parsed: Mapping[str, Any], hr_rest: float, hr_max: float
) -> dict[int, float]:
    """Time in each HR zone, derived from the record stream by HR reserve."""
    records = [r for r in (parsed.get("records") or []) if r.get("hr") is not None]
    if len(records) < 2:
        return {}
    denom = hr_max - hr_rest
    if denom <= 0:
        return {}
    zones: dict[int, float] = {}
    for prev, cur in zip(records, records[1:]):
        dt = cur["timestamp"] - prev["timestamp"]
        if dt <= 0 or dt > 60:  # a gap longer than a minute is a pause, not training
            continue
        hrr = (float(prev["hr"]) - hr_rest) / denom
        zone = 5
        for z, upper in ((1, 0.60), (2, 0.70), (3, 0.80), (4, 0.90)):
            if hrr < upper:
                zone = z
                break
        zones[zone] = zones.get(zone, 0.0) + dt
    return zones


def read_fit(path: Path | str) -> dict[str, Any]:
    """Parse a .fit file from disk."""
    import fitdecode

    path = Path(path)
    with fitdecode.FitReader(str(path)) as reader:
        frames = [f for f in reader if isinstance(f, fitdecode.FitDataMessage)]
    return parse_frames(frames)


def import_fit_file(store, path: Path | str, tz_offset_hours: float = 0.0) -> dict[str, Any]:
    """Read a FIT file, archive it, and upsert the activity, samples and zones."""
    from ..analytics import load as load_mod
    from ..analytics import performance as perf

    path = Path(path)
    parsed = read_fit(path)
    activity_id = f"fit-{path.stem}"

    # The archive holds the *parsed* structure, not the binary: the .fit file itself
    # stays on disk as the true original, and this makes re-normalising cheap.
    raw_id = store.store_raw(
        "fitfile",
        "activities",
        activity_id,
        {"file": path.name, "session": parsed["session"], "n_records": len(parsed["records"])},
    )

    row = to_activity(parsed, activity_id, tz_offset_hours)
    if row is None:
        return {"file": path.name, "imported": False, "reason": "no usable messages"}

    zones = hr_zone_seconds(parsed, store.settings.hr_rest, store.settings.hr_max)
    row["trimp"] = load_mod.activity_trimp(row, zones, store.settings)
    row["raw_id"] = raw_id

    samples = to_samples(parsed, activity_id)
    with store.tx():
        store.upsert("activities", ["activity_id"], row)
        for zone, secs in zones.items():
            store.upsert(
                "activity_hr_zones",
                ["activity_id", "zone"],
                {"activity_id": activity_id, "zone": zone, "seconds": secs},
            )
        for s in samples:
            store.upsert("activity_samples", ["activity_id", "elapsed_s"], s)
    perf.rebuild_best_efforts(store, [activity_id])

    return {
        "file": path.name,
        "imported": True,
        "activity_id": activity_id,
        "samples": len(samples),
        "zones": len(zones),
        "distance_m": row["distance_m"],
    }
