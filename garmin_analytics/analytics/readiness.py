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
from . import plan as plan_mod
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
        # A fresh install, before the first sync, lands here. Callers index this
        # dict by key (the CLI report did, and crashed), so the empty shape must
        # match the populated one exactly — same keys, empty values.
        return {
            "day": None,
            "score": None,
            "band": None,
            "components": {},
            "weights": WEIGHTS,
            "reasons": ["No data."],
            "recommendation": "Not enough data to judge.",
            "garmin_training_readiness": None,
            "flags": [],
        }

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
        # Training load alone says nothing about how rested the body is. Before the watch
        # recorded sleep or heart rate, renormalising left only TSB, which drew a flat,
        # confident line over weeks with no recovery data at all.
        has_recovery_signal = any(comps[k] is not None for k in ("sleep", "hrv", "rhr"))
        score = composite(comps) if has_recovery_signal else None
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
    target_distance_m: float | None = None,
) -> dict[str, object] | None:
    """Riegel projection to the race distance from the most informative recent best.

    Prefers the longest effort at or under the target distance — extrapolating a HM
    from a 1 k flatters the athlete badly, so we only use it if nothing longer exists.
    """
    # No distance, no projection: the race comes from the calendar now, and one may
    # name no distance at all.
    if target_distance_m is None:
        return None

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
        "SELECT day, distance_m FROM v_activities_included "
        "WHERE activity_type = 'running' ORDER BY day"
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
    hi = store.scalar("SELECT MAX(day) FROM v_activities_included")
    if not hi:
        return 0.0
    lo = (date.fromisoformat(hi) - timedelta(days=days - 1)).isoformat()
    total = store.scalar(
        "SELECT SUM(distance_m) FROM v_activities_included "
        "WHERE activity_type = 'running' AND day BETWEEN ? AND ?",
        (lo, hi),
    )
    return round(float(total or 0.0) / 1000.0 / (days / 7.0), 1)


def compute_race(store, today: date | None = None) -> dict[str, object]:
    """The race panel. The race itself comes from the calendar (T57), so with none
    named ahead the countdown and the projection are null rather than a constant
    counting backwards from a race already run."""
    from .plan import goal_race

    today = today or date.today()
    race = goal_race(store, today)
    days_to_go = None if race is None else (date.fromisoformat(race["date"]) - today).days

    bests_recent = perf.personal_bests(store, since_day=perf._days_ago(store, 120))
    bests_all = perf.personal_bests(store)
    projection = (
        None
        if race is None or race["distance_m"] is None
        else project_race_time(bests_recent or bests_all, float(race["distance_m"]))
    )

    load = load_mod.compute_load(store)
    current = load.get("current") or {}
    ctl = float(current.get("ctl") or 0.0)

    weeks = weekly_distance(store)
    avg_km = trailing_weekly_km(store, 28)

    # D12: the targets are the plan's, or there are none. With no calendar subscribed
    # this panel draws its curves without a goal line rather than inventing one.
    targets = plan_mod.race_targets(store, today)
    km_target = targets["peak_weekly_km"]
    ctl_target = targets["ctl_target"]

    # Straight-line CTL requirement to hit the target by race week.
    weeks_left = 0.0 if days_to_go is None else max(days_to_go / 7.0, 0.0)
    ctl_per_week_needed = (
        round((ctl_target - ctl) / weeks_left, 2)
        if ctl_target is not None and weeks_left >= 1
        else None
    )

    # Each note carries its own severity. Guessing severity from the wording in the
    # frontend gets it backwards — "already above target" contains the word "above".
    notes: list[dict[str, str]] = []

    def note(level: str, text: str) -> None:
        notes.append({"level": level, "text": text})

    # "Race date has passed" is gone with the constant: `goal_race` only ever returns
    # one still ahead, so a negative countdown is no longer reachable. What is
    # reachable is having no race named at all.
    if race is None:
        # "good" rather than a new level: the sibling no-plan note below uses it for
        # the same kind of statement, and `NoteLevel` is a Literal the response model
        # enforces — a value it does not allow is a 500 on a route nobody touched (T30).
        note(
            "good",
            "No race in the calendar yet. Add one with RACE in its title and the "
            "countdown and targets follow it.",
        )
    if ctl_target is None:
        note(
            "good",
            "No training plan is connected, so there is no target to measure against — "
            "connect the calendar in Settings.",
        )
    elif ctl >= ctl_target:
        note("good", f"CTL {ctl:.0f} is at or above the {ctl_target:.0f} the plan implies.")
    elif ctl_per_week_needed is not None:
        note(
            "warning" if ctl_per_week_needed > 5 else "good",
            f"Needs +{ctl_per_week_needed:.1f} CTL/week to reach {ctl_target:.0f} by race "
            f"day — sustainable is roughly +3 to +5.",
        )
    if load.get("ramp_flag"):
        note("warning", f"Ramp rate {load.get('ramp_pct')}%/wk is above the 10% flag — back off.")
    if avg_km and km_target:
        if avg_km < km_target * 0.6:
            note(
                "warning",
                f"28-day average {avg_km:.0f} km/wk against the plan's "
                f"{km_target:.0f} km peak week — a long way short.",
            )
        elif avg_km < km_target * 0.9:
            note(
                "good",
                f"28-day average {avg_km:.0f} km/wk, building toward the plan's "
                f"{km_target:.0f} km peak week.",
            )

    return {
        "race": race,
        "today": today.isoformat(),
        "days_to_go": days_to_go,
        "weeks_to_go": None if days_to_go is None else round(weeks_left, 1),
        "projection": projection,
        "ctl_now": round(ctl, 1),
        "ctl_target": ctl_target,
        "ctl_per_week_needed": ctl_per_week_needed,
        "tsb_now": current.get("tsb"),
        "weekly_km": weeks[-26:],
        "weekly_km_avg_4wk": avg_km,
        "weekly_km_target": km_target,
        "targets": targets,
        "recent_bests": bests_recent,
        "notes": notes,
    }
