"""Raw Garmin JSON -> typed rows.

Garmin's undocumented Connect API is inconsistent: the same quantity appears under
different keys depending on endpoint, device and era, and fields vanish without notice.
Every extractor here therefore takes a list of candidate keys and returns None rather
than raising, and every function is a pure dict-in / dict-out transform so the test
fixtures can be handwritten and hand-checked.

Units are normalised on the way in:
  * durations  -> seconds
  * distances  -> metres
  * speeds     -> metres/second
  * weight     -> kilograms (Garmin reports grams)
  * timestamps -> 'YYYY-MM-DDTHH:MM:SS' local, or '...Z' for UTC
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Iterable, Mapping, Sequence

# Garmin activity typeKeys mapped onto the coarse buckets this app reasons about.
TYPE_MAP = {
    "running": "running",
    "street_running": "running",
    "trail_running": "running",
    "track_running": "running",
    # Indoor variants keep their own bucket rather than collapsing into the outdoor
    # one: they have no GPS, no elevation and usually a different pace profile, so
    # folding them together quietly distorts every per-type average — and the user
    # can no longer filter them out. They are still runs; they are not the same runs.
    "treadmill_running": "treadmill_running",
    "indoor_running": "treadmill_running",
    "virtual_run": "treadmill_running",
    "cycling": "cycling",
    "road_biking": "cycling",
    "mountain_biking": "cycling",
    "gravel_cycling": "cycling",
    "indoor_cycling": "indoor_cycling",
    "virtual_ride": "indoor_cycling",
    "lap_swimming": "swimming",
    "open_water_swimming": "swimming",
    "swimming": "swimming",
    "walking": "walking",
    "hiking": "walking",
    "casual_walking": "walking",
    "speed_walking": "walking",
    "strength_training": "strength_training",
    "indoor_cardio": "other",
    "yoga": "other",
}


def pick(d: Mapping[str, Any] | None, *keys: str, default: Any = None) -> Any:
    """First present, non-None value among `keys`. Supports 'a.b.c' dotted paths."""
    if not d:
        return default
    for key in keys:
        cur: Any = d
        for part in key.split("."):
            if isinstance(cur, Mapping) and part in cur:
                cur = cur[part]
            else:
                cur = None
                break
        if cur is not None:
            return cur
    return default


def as_float(v: Any) -> float | None:
    if v is None or isinstance(v, bool):
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if f == f else None  # drop NaN


def as_int(v: Any) -> int | None:
    f = as_float(v)
    return None if f is None else int(round(f))


def iso_local(v: Any) -> str | None:
    """Garmin local timestamps arrive as 'YYYY-MM-DD HH:MM:SS' or epoch milliseconds."""
    if v is None:
        return None
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return datetime.fromtimestamp(float(v) / 1000.0, tz=timezone.utc).strftime(
            "%Y-%m-%dT%H:%M:%S"
        )
    s = str(v).strip()
    if not s:
        return None
    s = s.replace("Z", "").replace(".0", "") if s.endswith(".0") else s.replace("Z", "")
    return s.replace(" ", "T")[:19]


def iso_utc(v: Any) -> str | None:
    s = iso_local(v)
    return None if s is None else s + "Z"


def day_of(ts: str | None) -> str | None:
    return ts[:10] if ts else None


# ---------------------------------------------------------------------------
# Activities
# ---------------------------------------------------------------------------


def normalize_activity(payload: Mapping[str, Any]) -> dict[str, Any]:
    """One entry from `/activitylist-service/activities/search/activities`."""
    start_local = iso_local(pick(payload, "startTimeLocal", "startTimeLocalStr"))
    start_utc = iso_utc(pick(payload, "startTimeGMT", "startTimeGmt"))
    type_key = str(pick(payload, "activityType.typeKey", "activityTypeDTO.typeKey", default="other"))

    distance = as_float(pick(payload, "distance", "summaryDTO.distance"))
    duration = as_float(pick(payload, "duration", "elapsedDuration", "summaryDTO.duration"))
    moving = as_float(pick(payload, "movingDuration", "summaryDTO.movingDuration")) or duration

    avg_speed = as_float(pick(payload, "averageSpeed", "summaryDTO.averageSpeed"))
    if avg_speed is None and distance and moving:
        avg_speed = distance / moving

    return {
        "activity_id": str(pick(payload, "activityId", "activityUUID.uuid", default="")),
        "day": day_of(start_local) or day_of(start_utc),
        "start_time_local": start_local,
        "start_time_utc": start_utc,
        "activity_type": TYPE_MAP.get(type_key, "other"),
        "activity_name": pick(payload, "activityName"),
        "distance_m": distance,
        "duration_s": duration,
        "moving_time_s": moving,
        "avg_hr": as_float(pick(payload, "averageHR", "summaryDTO.averageHR")),
        "max_hr": as_float(pick(payload, "maxHR", "summaryDTO.maxHR")),
        "avg_speed_mps": avg_speed,
        "max_speed_mps": as_float(pick(payload, "maxSpeed", "summaryDTO.maxSpeed")),
        "elevation_gain_m": as_float(pick(payload, "elevationGain", "summaryDTO.elevationGain")),
        "calories": as_float(pick(payload, "calories", "summaryDTO.calories")),
        "avg_cadence_spm": as_float(
            pick(
                payload,
                "averageRunningCadenceInStepsPerMinute",
                "averageBikingCadenceInRevPerMinute",
                "averageCadence",
            )
        ),
        "avg_power_w": as_float(pick(payload, "avgPower", "averagePower", "summaryDTO.averagePower")),
        "training_effect_aerobic": as_float(
            pick(payload, "aerobicTrainingEffect", "summaryDTO.trainingEffect")
        ),
        "training_effect_anaerobic": as_float(
            pick(payload, "anaerobicTrainingEffect", "summaryDTO.anaerobicTrainingEffect")
        ),
    }


def normalize_export_activity(payload: Mapping[str, Any]) -> dict[str, Any]:
    """One entry from the GDPR export's `*_summarizedActivities.json`.

    The export is *not* the API shape. Its activity records use epoch-millisecond
    timestamps, centimetre distances and millisecond durations, and name the sport as a
    bare string. Converting those units in the same function as the API shape would make
    both unreadable, so this is separate.
    """
    begin_ms = as_float(pick(payload, "beginTimestamp", "startTimeGmt"))
    start_utc = iso_utc(begin_ms) if begin_ms else iso_utc(pick(payload, "startTimeGmt"))
    local_ms = as_float(pick(payload, "startTimeLocal"))
    start_local = (
        iso_local(local_ms) if local_ms else iso_local(pick(payload, "startTimeLocal"))
    ) or (start_utc[:-1] if start_utc else None)

    type_key = str(
        pick(payload, "activityType", "sportType", "activityType.typeKey", default="other")
    ).lower()

    distance_cm = as_float(pick(payload, "distance"))
    duration_ms = as_float(pick(payload, "duration", "elapsedDuration"))
    moving_ms = as_float(pick(payload, "movingDuration")) or duration_ms

    distance_m = None if distance_cm is None else distance_cm / 100.0
    duration_s = None if duration_ms is None else duration_ms / 1000.0
    moving_s = None if moving_ms is None else moving_ms / 1000.0

    avg_speed = as_float(pick(payload, "avgSpeed"))
    if avg_speed is not None:
        avg_speed = avg_speed / 1000.0  # export reports mm/s
    elif distance_m and moving_s:
        avg_speed = distance_m / moving_s
    max_speed = as_float(pick(payload, "maxSpeed"))
    if max_speed is not None:
        max_speed = max_speed / 1000.0

    elev = as_float(pick(payload, "elevationGain"))

    return {
        "activity_id": str(pick(payload, "activityId", default="")),
        "day": day_of(start_local),
        "start_time_local": start_local,
        "start_time_utc": start_utc,
        "activity_type": TYPE_MAP.get(type_key, "other"),
        "activity_name": pick(payload, "name", "activityName"),
        "distance_m": distance_m,
        "duration_s": duration_s,
        "moving_time_s": moving_s,
        "avg_hr": as_float(pick(payload, "avgHr", "averageHR")),
        "max_hr": as_float(pick(payload, "maxHr", "maxHR")),
        "avg_speed_mps": avg_speed,
        "max_speed_mps": max_speed,
        "elevation_gain_m": None if elev is None else elev / 100.0,
        "calories": as_float(pick(payload, "calories")),
        "avg_cadence_spm": as_float(pick(payload, "avgRunCadence", "avgBikeCadence")),
        "avg_power_w": as_float(pick(payload, "avgPower")),
        "training_effect_aerobic": as_float(pick(payload, "aerobicTrainingEffect")),
        "training_effect_anaerobic": as_float(pick(payload, "anaerobicTrainingEffect")),
    }


def normalize_hr_zones(payload: Any) -> dict[int, float]:
    """`/activity-service/activity/{id}/hrTimeInZones` -> {zone: seconds}.

    Garmin returns `secsInZone` as a float; zone numbers are 1-5 and occasionally
    arrive as strings.
    """
    out: dict[int, float] = {}
    if not isinstance(payload, Sequence) or isinstance(payload, (str, bytes)):
        return out
    for entry in payload:
        if not isinstance(entry, Mapping):
            continue
        zone = as_int(pick(entry, "zoneNumber", "zoneNum", "zone"))
        secs = as_float(pick(entry, "secsInZone", "secondsInZone", "seconds"))
        if zone is None or secs is None or not 1 <= zone <= 5:
            continue
        out[zone] = out.get(zone, 0.0) + secs
    return out


# ---------------------------------------------------------------------------
# Wellness
# ---------------------------------------------------------------------------


def normalize_sleep(payload: Mapping[str, Any], day: str | None = None) -> dict[str, Any] | None:
    """`/wellness-service/wellness/dailySleepData/{user}?date=YYYY-MM-DD`."""
    dto = pick(payload, "dailySleepDTO") or payload
    if not isinstance(dto, Mapping):
        return None
    cal = pick(dto, "calendarDate") or day
    if not cal:
        return None
    total = as_float(pick(dto, "sleepTimeSeconds", "totalSleepSeconds"))
    score = as_float(
        pick(dto, "sleepScores.overall.value", "sleepScores.overallScore", "sleepScore")
    )
    return {
        "day": str(cal)[:10],
        "total_sleep_s": total,
        "deep_s": as_float(pick(dto, "deepSleepSeconds")),
        "light_s": as_float(pick(dto, "lightSleepSeconds")),
        "rem_s": as_float(pick(dto, "remSleepSeconds")),
        "awake_s": as_float(pick(dto, "awakeSleepSeconds", "awakeCount")),
        "sleep_score": score,
        "overnight_hrv_ms": as_float(
            pick(payload, "avgOvernightHrv", "dailySleepDTO.avgOvernightHrv", "hrvData.avgHrv")
        ),
        "avg_respiration_brpm": as_float(
            pick(dto, "averageRespirationValue", "avgRespirationValue")
        ),
        "avg_spo2_pct": as_float(pick(dto, "averageSpO2Value", "averageSpo2Value")),
        "bedtime_local": iso_local(
            pick(dto, "sleepStartTimestampLocal", "sleepStartTimestampGMT")
        ),
        "waketime_local": iso_local(pick(dto, "sleepEndTimestampLocal", "sleepEndTimestampGMT")),
    }


def normalize_daily_summary(payload: Mapping[str, Any], day: str | None = None) -> dict[str, Any] | None:
    """`/usersummary-service/usersummary/daily/{user}?calendarDate=YYYY-MM-DD`."""
    cal = pick(payload, "calendarDate") or day
    if not cal:
        return None
    return {
        "day": str(cal)[:10],
        "resting_hr": as_float(pick(payload, "restingHeartRate", "restingHeartRateTimestamp")),
        "steps": as_int(pick(payload, "totalSteps", "steps")),
        "floors": as_int(pick(payload, "floorsAscended", "floorsAscendedInMeters")),
        "calories_total": as_float(pick(payload, "totalKilocalories")),
        "calories_active": as_float(pick(payload, "activeKilocalories")),
        "intensity_minutes_mod": as_int(pick(payload, "moderateIntensityMinutes")),
        "intensity_minutes_vig": as_int(pick(payload, "vigorousIntensityMinutes")),
        "stress_avg": as_float(pick(payload, "averageStressLevel", "avgStressLevel")),
        "stress_max": as_float(pick(payload, "maxStressLevel")),
        "bb_high": as_int(pick(payload, "bodyBatteryHighestValue")),
        "bb_low": as_int(pick(payload, "bodyBatteryLowestValue")),
        "bb_charged": as_int(pick(payload, "bodyBatteryChargedValue")),
        "bb_drained": as_int(pick(payload, "bodyBatteryDrainedValue")),
    }


def normalize_hrv(payload: Mapping[str, Any], day: str | None = None) -> dict[str, Any] | None:
    """`/hrv-service/hrv/{date}`."""
    summary = pick(payload, "hrvSummary") or payload
    if not isinstance(summary, Mapping):
        return None
    cal = pick(summary, "calendarDate") or day
    if not cal:
        return None
    return {
        "day": str(cal)[:10],
        "last_night_avg": as_float(pick(summary, "lastNightAvg", "weeklyAvg")),
        "last_night_5min_high": as_float(pick(summary, "lastNight5MinHigh")),
        "weekly_avg": as_float(pick(summary, "weeklyAvg")),
        "baseline_low": as_float(
            pick(summary, "baseline.balancedLow", "baseline.lowUpper")
        ),
        "baseline_high": as_float(
            pick(summary, "baseline.balancedUpper", "baseline.markerValue")
        ),
        "status": pick(summary, "status"),
    }


def normalize_training_readiness(payload: Any, day: str | None = None) -> dict[str, Any] | None:
    """`/metrics-service/metrics/trainingreadiness/{date}` — a list with one entry."""
    entry = payload[0] if isinstance(payload, list) and payload else payload
    if not isinstance(entry, Mapping):
        return None
    cal = pick(entry, "calendarDate") or day
    if not cal:
        return None
    return {"day": str(cal)[:10], "training_readiness": as_int(pick(entry, "score"))}


def normalize_training_status(payload: Mapping[str, Any], day: str | None = None) -> dict[str, Any] | None:
    """`/metrics-service/metrics/trainingstatus/aggregated/{date}`.

    VO2max and training status hide behind a per-device map keyed by device id, so
    the first (and in practice only) value is taken.
    """
    if not isinstance(payload, Mapping):
        return None
    cal = pick(payload, "calendarDate") or day
    if not cal:
        return None

    vo2_run = as_float(
        pick(
            payload,
            "mostRecentVO2Max.generic.vo2MaxPreciseValue",
            "mostRecentVO2Max.generic.vo2MaxValue",
        )
    )
    vo2_cycle = as_float(
        pick(payload, "mostRecentVO2Max.cycling.vo2MaxPreciseValue",
             "mostRecentVO2Max.cycling.vo2MaxValue")
    )

    status = None
    acute = chronic = None
    per_device = pick(payload, "mostRecentTrainingStatus.latestTrainingStatusData")
    if isinstance(per_device, Mapping):
        for entry in per_device.values():
            if isinstance(entry, Mapping):
                status = status or pick(entry, "trainingStatusFeedbackPhrase", "trainingStatus")
                acute = acute if acute is not None else as_float(
                    pick(entry, "acuteTrainingLoadDTO.acwrStatus", "acuteTrainingLoadDTO.dailyAcuteChronicWorkloadRatio")
                )
    load_dto = pick(payload, "mostRecentTrainingLoadBalance.metricsTrainingLoadBalanceDTOMap")
    if isinstance(load_dto, Mapping):
        for entry in load_dto.values():
            if isinstance(entry, Mapping):
                chronic = chronic if chronic is not None else as_float(
                    pick(entry, "monthlyLoadAerobicLow", "trainingBalanceFeedbackPhrase")
                )

    return {
        "day": str(cal)[:10],
        "vo2max_run": vo2_run,
        "vo2max_cycle": vo2_cycle,
        "training_status": None if status is None else str(status),
        "acute_load": acute,
        "chronic_load": chronic,
    }


def normalize_weight(payload: Mapping[str, Any], day: str | None = None) -> list[dict[str, Any]]:
    """`/weight-service/weight/dateRange` -> one row per day. Garmin reports grams.

    `day` is accepted and ignored: every normaliser is called with the same
    `(payload, day)` signature by the sync loop, and this endpoint carries its own
    dates. Omitting the parameter made `sync` raise TypeError on the body endpoint.
    """
    out: list[dict[str, Any]] = []
    summaries = pick(payload, "dailyWeightSummaries") or []
    if not isinstance(summaries, list):
        return out
    for s in summaries:
        if not isinstance(s, Mapping):
            continue
        day = pick(s, "summaryDate", "calendarDate")
        metrics = pick(s, "allWeightMetrics", "latestWeight")
        m = metrics[0] if isinstance(metrics, list) and metrics else metrics
        if not day or not isinstance(m, Mapping):
            continue
        grams = as_float(pick(m, "weight"))
        out.append(
            {
                "day": str(day)[:10],
                "weight_kg": None if grams is None else round(grams / 1000.0, 2),
                "body_fat_pct": as_float(pick(m, "bodyFat")),
                "bmi": as_float(pick(m, "bmi")),
            }
        )
    return out


def merge_daily(rows: Iterable[Mapping[str, Any]]) -> dict[str, dict[str, Any]]:
    """Merge partial per-day dicts (from different endpoints) into one row per day.

    Later non-None values win; None never overwrites a real value, so a training-status
    call that omits VO2max cannot blank one an earlier call already found.
    """
    merged: dict[str, dict[str, Any]] = {}
    for row in rows:
        if not row:
            continue
        day = row.get("day")
        if not day:
            continue
        target = merged.setdefault(str(day), {"day": str(day)})
        for k, v in row.items():
            if v is not None:
                target[k] = v
    return merged
