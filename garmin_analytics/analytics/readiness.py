"""Composite daily readiness, and the race panel for 2027-01-15.

Readiness is deliberately a transparent weighted sum, not a black box: every
component returns its own sub-score and a sentence explaining it, because a number
with no reason attached is not actionable at 6am.
"""

from __future__ import annotations

from datetime import date, timedelta
from typing import Mapping, Sequence

from .. import config
from . import load as load_mod
from . import performance as perf
from . import trends as trends_mod

# Component weights. They sum to 1.0; components with no data are dropped and the
# remainder is renormalised, so a missing HRV reading degrades the score's confidence
# rather than silently scoring it as zero.
WEIGHTS = {
    "sleep": 0.30,
    "hrv": 0.25,
    "tsb": 0.25,
    "rhr": 0.20,
}


def _clamp(x: float, lo: float = 0.0, hi: float = 100.0) -> float:
    return max(lo, min(hi, x))


def sleep_component(sleep_score: float | None, total_sleep_s: float | None) -> tuple[float | None, str]:
    """Garmin's sleep score if present, else hours slept mapped onto 0-100."""
    if sleep_score is not None:
        s = _clamp(float(sleep_score))
        if s >= 80:
            return s, f"Sleep score {s:.0f} — good."
        if s >= 60:
            return s, f"Sleep score {s:.0f} — fair."
        return s, f"Sleep score {s:.0f} — poor."
    if total_sleep_s is not None:
        hours = float(total_sleep_s) / 3600.0
        # 8 h -> 100, 4 h -> 0, linear in between.
        s = _clamp((hours - 4.0) / 4.0 * 100.0)
        return s, f"Slept {hours:.1f} h (no sleep score available)."
    return None, "No sleep data."


def z_component(z: float | None, direction: int, label: str, unit: str = "") -> tuple[float | None, str]:
    """Map a z-score onto 0-100, where z=0 is 50 and ±2σ saturates.

    `direction` is +1 when a higher raw value is better.
    """
    if z is None:
        return None, f"No {label} baseline yet."
    signed = z * direction
    score = _clamp(50.0 + signed * 25.0)
    if signed <= -1.5:
        word = "well below"
    elif signed <= -0.75:
        word = "below"
    elif signed < 0.75:
        word = "at"
    elif signed < 1.5:
        word = "above"
    else:
        word = "well above"
    return score, f"{label} {word} baseline (z={z:+.2f}{unit})."


def tsb_component(tsb: float | None) -> tuple[float | None, str]:
    """Form. Slightly negative TSB is the productive zone, not the best-feeling one.

    We score *readiness to perform today*, so fresh scores high; the load module's
    `form_label` is what flags detraining risk.
    """
    if tsb is None:
        return None, "No training-load history."
    # -30 -> 0, +10 -> 100, flat above.
    score = _clamp((tsb + 30.0) / 40.0 * 100.0)
    return score, f"TSB {tsb:+.1f} — {load_mod.form_label(tsb)}."


def composite(components: Mapping[str, float | None]) -> float | None:
    """Weighted mean over the components that have data, renormalised."""
    usable = {k: v for k, v in components.items() if v is not None and k in WEIGHTS}
    if not usable:
        return None
    total_w = sum(WEIGHTS[k] for k in usable)
    return sum(WEIGHTS[k] * v for k, v in usable.items()) / total_w


def readiness_band(score: float) -> str:
    if score >= 80:
        return "prime"
    if score >= 65:
        return "ready"
    if score >= 50:
        return "moderate"
    if score >= 35:
        return "low"
    return "rest"


def recommendation(score: float, tsb: float | None, flags: Sequence[Mapping[str, object]]) -> str:
    bad = [f["metric"] for f in flags if str(f.get("verdict")) == "worse than baseline"]
    if score < 35:
        return "Rest or very easy. " + (f"Watch: {', '.join(bad)}." if bad else "")
    if score < 50:
        return "Easy aerobic only — no quality session today."
    if score < 65:
        return "Moderate session is fine; hold back on intensity."
    if tsb is not None and tsb < -20:
        return "Body says go, but form is deep in the hole — keep the volume, skip the extra."
    return "Green light for a hard or long session."


# ---------------------------------------------------------------------------
# Store-backed
# ---------------------------------------------------------------------------


def compute_readiness(store, day: str | None = None) -> dict[str, object]:
    day = day or store.scalar("SELECT MAX(day) FROM v_daily")
    if not day:
        return {"day": None, "score": None, "reasons": ["No data."], "components": {}}

    row = store.query("SELECT * FROM v_daily WHERE day = ?", (day,))
    latest = row[0] if row else {}

    tr = trends_mod.compute_trends(store, days=120, metrics=["resting_hr", "hrv"])
    hrv_z = (tr["metrics"].get("hrv") or {}).get("z")
    rhr_z = (tr["metrics"].get("resting_hr") or {}).get("z")

    curve = load_mod.compute_load(store)
    tsb = (curve.get("current") or {}).get("tsb")

    sleep_s, sleep_why = sleep_component(latest.get("sleep_score"), latest.get("total_sleep_s"))
    hrv_s, hrv_why = z_component(hrv_z, +1, "HRV")
    rhr_s, rhr_why = z_component(rhr_z, -1, "Resting HR")
    tsb_s, tsb_why = tsb_component(None if tsb is None else float(tsb))

    components = {"sleep": sleep_s, "hrv": hrv_s, "tsb": tsb_s, "rhr": rhr_s}
    score = composite(components)

    all_flags = trends_mod.compute_trends(store, days=120)["flags"]

    return {
        "day": day,
        "score": None if score is None else round(score, 1),
        "band": None if score is None else readiness_band(score),
        "components": {
            k: (None if v is None else round(v, 1)) for k, v in components.items()
        },
        "weights": WEIGHTS,
        "reasons": [sleep_why, hrv_why, tsb_why, rhr_why],
        "recommendation": (
            "Not enough data to judge." if score is None
            else recommendation(score, None if tsb is None else float(tsb), all_flags)
        ),
        "garmin_training_readiness": latest.get("training_readiness"),
        "flags": all_flags,
    }


def readiness_history(store, days: int = 90) -> list[dict[str, object]]:
    """Daily readiness back through `days`, computed from the same components.

    Recomputes trends once and walks the window, rather than calling compute_readiness
    per day (which would be O(n) full-table scans).
    """
    rows = store.query("SELECT * FROM v_daily ORDER BY day")
    if not rows:
        return []
    curve = {c["day"]: c for c in load_mod.compute_load(store).get("curve", [])}

    hrv_vals = [r.get("hrv") for r in rows]
    rhr_vals = [r.get("resting_hr") for r in rows]

    out = []
    for i in range(max(0, len(rows) - days), len(rows)):
        r = rows[i]
        base_lo = max(0, i - trends_mod.BASELINE_DAYS)
        hrv_z = trends_mod.zscore(hrv_vals[i], hrv_vals[base_lo:i])
        rhr_z = trends_mod.zscore(rhr_vals[i], rhr_vals[base_lo:i])
        tsb = (curve.get(str(r["day"])) or {}).get("tsb")
        comps = {
            "sleep": sleep_component(r.get("sleep_score"), r.get("total_sleep_s"))[0],
            "hrv": z_component(hrv_z, +1, "HRV")[0],
            "rhr": z_component(rhr_z, -1, "Resting HR")[0],
            "tsb": tsb_component(None if tsb is None else float(tsb))[0],
        }
        score = composite(comps)
        out.append(
            {
                "day": r["day"],
                "score": None if score is None else round(score, 1),
                "band": None if score is None else readiness_band(score),
            }
        )
    return out


# ---------------------------------------------------------------------------
# Race panel
# ---------------------------------------------------------------------------


def project_race_time(
    bests: Sequence[Mapping[str, object]],
    target_distance_m: float = config.RACE_DISTANCE_M,
) -> dict[str, object] | None:
    """Riegel projection to the race distance from the most informative recent best.

    Prefers the longest effort at or under the target distance — extrapolating a HM
    from a 1 k flatters the athlete badly, so we only use it if nothing longer exists.
    """
    usable = [b for b in bests if float(b["distance_m"]) <= target_distance_m * 1.05]
    if not usable:
        return None
    source = max(usable, key=lambda b: float(b["distance_m"]))
    seconds = perf.riegel(float(source["seconds"]), float(source["distance_m"]), target_distance_m)
    return {
        "from_distance_m": source["distance_m"],
        "from_label": source.get("label"),
        "from_time": source.get("time"),
        "from_day": source.get("day"),
        "projected_seconds": round(seconds, 1),
        "projected_time": perf.hms(seconds),
        "projected_pace": perf.pace_str(seconds / (target_distance_m / 1000.0)),
        "exponent": perf.RIEGEL_EXPONENT,
    }


def weekly_distance(store) -> list[dict[str, object]]:
    from . import reports as reports_mod

    rows = store.query(
        "SELECT day, distance_m FROM activities WHERE activity_type = 'running' ORDER BY day"
    )
    buckets: dict[str, float] = {}
    for r in rows:
        key = reports_mod.iso_week_key(str(r["day"]))
        buckets[key] = buckets.get(key, 0.0) + float(r["distance_m"] or 0.0)
    return [
        {
            "week": wk,
            "start": _week_start_from_key(wk),
            "km": round(km / 1000.0, 1),
        }
        for wk, km in sorted(buckets.items())
    ]


def _week_start_from_key(key: str) -> str:
    year, week = key.split("-W")
    return date.fromisocalendar(int(year), int(week), 1).isoformat()


def trailing_weekly_km(store, days: int = 28) -> float:
    """Running kilometres per week over the last `days`, anchored on the last activity.

    Using the last four *calendar* weeks would include the current, incomplete week
    and report a volume drop that is really just a Tuesday.
    """
    hi = store.scalar("SELECT MAX(day) FROM activities")
    if not hi:
        return 0.0
    lo = (date.fromisoformat(hi) - timedelta(days=days - 1)).isoformat()
    total = store.scalar(
        "SELECT SUM(distance_m) FROM activities "
        "WHERE activity_type = 'running' AND day BETWEEN ? AND ?",
        (lo, hi),
    )
    return round(float(total or 0.0) / 1000.0 / (days / 7.0), 1)


def compute_race(store, today: date | None = None) -> dict[str, object]:
    today = today or date.today()
    days_to_go = (config.RACE_DATE - today).days

    bests_recent = perf.personal_bests(store, since_day=perf._days_ago(store, 120))
    bests_all = perf.personal_bests(store)
    projection = project_race_time(bests_recent or bests_all)

    load = load_mod.compute_load(store)
    current = load.get("current") or {}
    ctl = float(current.get("ctl") or 0.0)

    weeks = weekly_distance(store)
    avg_km = trailing_weekly_km(store, 28)

    # Straight-line CTL requirement to hit the target by race week.
    weeks_left = max(days_to_go / 7.0, 0.0)
    ctl_gap = config.TARGET_PEAK_CTL - ctl
    ctl_per_week_needed = round(ctl_gap / weeks_left, 2) if weeks_left >= 1 else None

    # Each note carries its own severity. Guessing severity from the wording in the
    # frontend gets it backwards — "already above target" contains the word "above".
    notes: list[dict[str, str]] = []

    def note(level: str, text: str) -> None:
        notes.append({"level": level, "text": text})

    if days_to_go < 0:
        note("warning", "Race date has passed.")
    if ctl >= config.TARGET_PEAK_CTL:
        note("good", f"CTL {ctl:.0f} is at or above the {config.TARGET_PEAK_CTL:.0f} target.")
    elif ctl_per_week_needed is not None:
        note(
            "warning" if ctl_per_week_needed > 5 else "good",
            f"Needs +{ctl_per_week_needed:.1f} CTL/week to reach {config.TARGET_PEAK_CTL:.0f} "
            f"by race day — sustainable is roughly +3 to +5.",
        )
    if load.get("ramp_flag"):
        note("warning", f"Ramp rate {load.get('ramp_pct')}%/wk is above the 10% flag — back off.")
    if avg_km:
        if avg_km < config.TARGET_PEAK_WEEKLY_KM * 0.6:
            note(
                "warning",
                f"28-day average {avg_km:.0f} km/wk against a "
                f"{config.TARGET_PEAK_WEEKLY_KM:.0f} km target peak — a long way short.",
            )
        elif avg_km < config.TARGET_PEAK_WEEKLY_KM * 0.9:
            note(
                "good",
                f"28-day average {avg_km:.0f} km/wk, building toward the "
                f"{config.TARGET_PEAK_WEEKLY_KM:.0f} km target peak.",
            )

    return {
        "race": {
            "name": config.RACE_NAME,
            "date": config.RACE_DATE.isoformat(),
            "start_local": config.RACE_START_LOCAL,
            "timezone": config.RACE_TIMEZONE,
            "distance_m": config.RACE_DISTANCE_M,
        },
        "today": today.isoformat(),
        "days_to_go": days_to_go,
        "weeks_to_go": round(weeks_left, 1),
        "projection": projection,
        "ctl_now": round(ctl, 1),
        "ctl_target": config.TARGET_PEAK_CTL,
        "ctl_per_week_needed": ctl_per_week_needed,
        "tsb_now": current.get("tsb"),
        "weekly_km": weeks[-26:],
        "weekly_km_avg_4wk": avg_km,
        "weekly_km_target": config.TARGET_PEAK_WEEKLY_KM,
        "recent_bests": bests_recent,
        "notes": notes,
    }
