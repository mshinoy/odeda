"""Training load: TRIMP, CTL, ATL, TSB, ramp rate.

References
----------
Banister's TRIMP:   TRIMP = duration_min * HRr * 0.64 * e^(k * HRr)
  where HRr = (HR_avg - HR_rest) / (HR_max - HR_rest) and k = 1.92 (male) / 1.67 (female).

CTL/ATL are the standard exponentially weighted moving averages used by TrainingPeaks:
  today = yesterday + (load_today - yesterday) * (1 - e^(-1/tau))
with tau = 42 days (chronic) and 7 days (acute). TSB = CTL - ATL, reported for *today*
(i.e. using yesterday's CTL/ATL is a common variant; we use same-day, and say so).
"""

from __future__ import annotations

import math
from datetime import date, timedelta
from typing import Mapping, Sequence

CTL_TAU_DAYS = 42
ATL_TAU_DAYS = 7
RAMP_FLAG_PCT = 10.0  # weekly CTL ramp above this is flagged

# Banister exponent, by sex.
TRIMP_K = {"male": 1.92, "female": 1.67}

# Zone upper bounds as a fraction of HR reserve, and the representative HRr we use
# when only zone time (not average HR) is available.
ZONE_HRR_MIDPOINTS = {1: 0.55, 2: 0.65, 3: 0.75, 4: 0.85, 5: 0.95}


def trimp(
    duration_min: float,
    avg_hr: float,
    hr_rest: float,
    hr_max: float,
    sex: str = "male",
) -> float:
    """Banister TRIMP for a single bout.

    Returns 0.0 for non-positive duration or an average HR at/below resting —
    a walk at resting HR contributes no training impulse.
    """
    if duration_min <= 0 or avg_hr is None:
        return 0.0
    denom = hr_max - hr_rest
    if denom <= 0:
        return 0.0
    hrr = (avg_hr - hr_rest) / denom
    if hrr <= 0:
        return 0.0
    hrr = min(hrr, 1.0)
    k = TRIMP_K.get(sex.lower(), TRIMP_K["male"])
    return duration_min * hrr * 0.64 * math.exp(k * hrr)


def trimp_from_zones(
    zone_seconds: Mapping[int, float],
    hr_rest: float,
    hr_max: float,
    sex: str = "male",
) -> float:
    """TRIMP summed over HR-zone dwell times.

    More faithful than a single average HR for interval sessions, because the
    exponential term is applied per zone rather than to a flattened mean.
    """
    total = 0.0
    k = TRIMP_K.get(sex.lower(), TRIMP_K["male"])
    for zone, seconds in zone_seconds.items():
        if not seconds or seconds <= 0:
            continue
        hrr = ZONE_HRR_MIDPOINTS.get(int(zone))
        if hrr is None:
            continue
        total += (seconds / 60.0) * hrr * 0.64 * math.exp(k * hrr)
    return total


def ewma_series(
    daily_load: Sequence[float],
    tau_days: float,
    seed: float = 0.0,
) -> list[float]:
    """Exponentially weighted moving average over a dense daily series.

    `daily_load[i]` must be the load for day i with zeros for rest days —
    the decay is what makes rest days matter, so gaps cannot be skipped.
    """
    alpha = 1.0 - math.exp(-1.0 / tau_days)
    out: list[float] = []
    prev = seed
    for load in daily_load:
        prev = prev + (float(load) - prev) * alpha
        out.append(prev)
    return out


def densify(
    loads_by_day: Mapping[str, float],
    start: date,
    end: date,
) -> tuple[list[str], list[float]]:
    """Expand a sparse {day: load} map to a dense day-by-day series, zero-filled."""
    days: list[str] = []
    values: list[float] = []
    cur = start
    while cur <= end:
        key = cur.isoformat()
        days.append(key)
        values.append(float(loads_by_day.get(key, 0.0)))
        cur += timedelta(days=1)
    return days, values


def load_curve(
    loads_by_day: Mapping[str, float],
    start: date,
    end: date,
    ctl_seed: float = 0.0,
    atl_seed: float = 0.0,
) -> list[dict[str, float | str]]:
    """Full daily CTL/ATL/TSB curve between two dates inclusive."""
    days, values = densify(loads_by_day, start, end)
    ctl = ewma_series(values, CTL_TAU_DAYS, ctl_seed)
    atl = ewma_series(values, ATL_TAU_DAYS, atl_seed)
    return [
        {
            "day": d,
            "load": round(v, 2),
            "ctl": round(c, 2),
            "atl": round(a, 2),
            "tsb": round(c - a, 2),
        }
        for d, v, c, a in zip(days, values, ctl, atl)
    ]


def ramp_rate(curve: Sequence[Mapping[str, float | str]], window_days: int = 7) -> float | None:
    """Percent change in CTL over the last `window_days`.

    Returns None when there is not enough history, or when the earlier CTL is
    effectively zero (a percentage off zero is meaningless, not infinite).
    """
    if len(curve) <= window_days:
        return None
    now = float(curve[-1]["ctl"])
    then = float(curve[-1 - window_days]["ctl"])
    if then < 1e-6:
        return None
    return (now - then) / then * 100.0


def weekly_loads(curve: Sequence[Mapping[str, float | str]]) -> list[dict[str, float | str]]:
    """Aggregate the daily curve into ISO weeks."""
    buckets: dict[str, dict[str, float | str]] = {}
    for row in curve:
        d = date.fromisoformat(str(row["day"]))
        iso = d.isocalendar()
        key = f"{iso.year}-W{iso.week:02d}"
        b = buckets.setdefault(
            key,
            {"week": key, "start": (d - timedelta(days=iso.weekday - 1)).isoformat(), "load": 0.0},
        )
        b["load"] = float(b["load"]) + float(row["load"])
        b["ctl_end"] = row["ctl"]
        b["atl_end"] = row["atl"]
        b["tsb_end"] = row["tsb"]
    weeks = sorted(buckets.values(), key=lambda b: str(b["week"]))
    for i, wk in enumerate(weeks):
        wk["load"] = round(float(wk["load"]), 1)
        prev = float(weeks[i - 1]["load"]) if i else 0.0
        wk["delta_pct"] = round((float(wk["load"]) - prev) / prev * 100.0, 1) if prev > 0 else None
        # The over-training flag is on the CTL ramp, not on raw weekly load. A 3:1
        # mesocycle makes raw load jump ~40 % every fourth week by design; flagging
        # that would cry wolf on every post-recovery week. CTL is what actually has to
        # stay under ~10 %/wk.
        prev_ctl = float(weeks[i - 1].get("ctl_end") or 0.0) if i else 0.0
        cur_ctl = float(wk.get("ctl_end") or 0.0)
        wk["ctl_delta_pct"] = (
            round((cur_ctl - prev_ctl) / prev_ctl * 100.0, 1) if prev_ctl > 1e-6 else None
        )
        wk["overreaching"] = bool(
            wk["ctl_delta_pct"] is not None and wk["ctl_delta_pct"] > RAMP_FLAG_PCT
        )
    return weeks


# ---------------------------------------------------------------------------
# Store-backed
# ---------------------------------------------------------------------------


def activity_trimp(activity: Mapping[str, object], zones: Mapping[int, float], settings) -> float:
    """TRIMP for one stored activity: prefer zone dwell times, fall back to average HR."""
    if zones:
        return trimp_from_zones(zones, settings.hr_rest, settings.hr_max, settings.sex)
    avg_hr = activity.get("avg_hr")
    dur = activity.get("moving_time_s") or activity.get("duration_s") or 0
    if avg_hr is None:
        return 0.0
    return trimp(float(dur) / 60.0, float(avg_hr), settings.hr_rest, settings.hr_max, settings.sex)


def recompute_trimp(store) -> int:
    """Recompute the stored TRIMP of every activity from its zone dwell times (or average
    heart rate), after the heart-rate limits changed. TRIMP is written when an activity is
    first read, so without this the new limits would only apply to future activities and
    the load curve would mix two sets of numbers. No network and nothing re-parsed."""
    zones: dict[str, dict[int, float]] = {}
    for r in store.query("SELECT activity_id, zone, seconds FROM activity_hr_zones"):
        zones.setdefault(r["activity_id"], {})[int(r["zone"])] = float(r["seconds"] or 0.0)
    n = 0
    for a in store.query(
        "SELECT activity_id, avg_hr, moving_time_s, duration_s FROM activities"
    ):
        value = activity_trimp(dict(a), zones.get(a["activity_id"], {}), store.settings)
        store.conn.execute(
            "UPDATE activities SET trimp = ? WHERE activity_id = ?", (value, a["activity_id"])
        )
        n += 1
    store.conn.commit()
    return n


def daily_loads(store) -> dict[str, float]:
    """Sum stored per-activity TRIMP by day.

    Reads `v_activities_included`, not `activities`: an activity the user flagged
    exclude-from-stats contributes no training impulse. A watch left running in the
    car for four hours is not four hours of fatigue, and leaving it in poisons CTL,
    ATL, TSB and every readiness score derived from them for the next six weeks.
    """
    rows = store.query(
        "SELECT day, SUM(COALESCE(trimp, 0)) AS load FROM v_activities_included "
        "GROUP BY day ORDER BY day"
    )
    return {r["day"]: float(r["load"] or 0.0) for r in rows}


def compute_load(
    store,
    start: str | None = None,
    end: str | None = None,
    today: date | None = None,
) -> dict[str, object]:
    """Whole training-load picture for the API.

    Unless `end` is given the curve runs to today, not to the last activity. Form is read
    off the last point, and a curve that stopped at the last workout held fatigue at its
    post-workout value however long the athlete had rested since.
    """
    loads = daily_loads(store)
    if not loads:
        return {"curve": [], "weeks": [], "current": None, "ramp_pct": None}
    lo = date.fromisoformat(start) if start else date.fromisoformat(min(loads))
    if end:
        hi = date.fromisoformat(end)
    else:
        hi = max(date.fromisoformat(max(loads)), today or date.today())
    curve = load_curve(loads, lo, hi)
    weeks = weekly_loads(curve)
    ramp = ramp_rate(curve)
    latest = curve[-1]
    # CTL is seeded at zero, so the first chronic time constant of any series ramps
    # steeply no matter what the athlete did. Say so rather than letting the chart
    # imply a heroic first six weeks.
    warmup_until = (lo + timedelta(days=CTL_TAU_DAYS)).isoformat()
    return {
        "curve": curve,
        "weeks": weeks,
        "warmup_until": warmup_until,
        "warmup_note": (
            f"CTL/ATL start from zero on {lo.isoformat()}; values before "
            f"{warmup_until} are a cold-start artefact, not fitness."
        ),
        "current": {
            "day": latest["day"],
            "ctl": latest["ctl"],
            "atl": latest["atl"],
            "tsb": latest["tsb"],
            "form": form_label(float(latest["tsb"])),
        },
        "ramp_pct": round(ramp, 1) if ramp is not None else None,
        "ramp_flag": bool(ramp is not None and ramp > RAMP_FLAG_PCT),
    }


def form_label(tsb: float) -> str:
    """Plain-English reading of training stress balance."""
    if tsb > 15:
        return "very fresh (detraining risk)"
    if tsb > 5:
        return "fresh"
    if tsb >= -10:
        return "neutral"
    if tsb >= -25:
        return "fatigued (productive)"
    return "very fatigued"
