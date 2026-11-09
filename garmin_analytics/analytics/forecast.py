"""Looking forward to race morning: how fresh the plan leaves you, and a finish-time range.

Two questions the race panel could not answer. It said what the athlete's form is
*today* and projected one time from one effort; it did not say what the remaining plan
does to fatigue, or how much a single projection should be trusted.

**Form forecast.** The plan's remaining running kilometres are priced in the owner's own
load per kilometre (`plan.load_per_km`, the same exchange rate the CTL target uses) and
run through the same CTL/ATL recurrences as the history. The curve ends the day before
the race, because race morning's form is the state at the end of the previous day. Two
scenarios: every session as prescribed, and the sessions at the share of the plan's
kilometres actually run over the last four weeks, which is closer to what happens.

**Time range.** Riegel from each recent effort of 5 km and up, rather than the one
longest. The spread between them is the range, and it always takes in the Riegel
exponent band on the longest effort. Then two adjustments, both small, both labelled rule-of-thumb and both
returned separately so the screen can show the range with and without them.

Neither forecast knows about non-running load (gym, rides), the course, the weather or
the day. Both say so in their `caveats`.
"""

from __future__ import annotations

import math
from datetime import date, timedelta
from typing import Any, Mapping, Sequence

from . import load as load_mod
from . import performance as perf
from . import plan as plan_mod

#: Race-morning TSB bands. A taper lands you fresh, not rested: TSB of roughly +5 to
#: +25 is the window coaches aim for, and much beyond it is detraining.
FRESH_LOW = 5.0
FRESH_HIGH = 25.0
FATIGUED_BELOW = -10.0
#: Fitness ending below this share of today's is falling, not tapering.
FITNESS_LOSS = 0.9

#: Only efforts this long say anything about a half marathon. A mile projected 13x
#: over flatters the athlete (see `readiness.project_race_time`).
MIN_SOURCE_M = 5000.0
#: Individual Riegel exponents run roughly 1.03 to 1.10 about the 1.06 average.
EXPONENT_BAND = (1.04, 1.08)

#: Rule of thumb, to be tuned against real races: 10% more CTL than when the effort was
#: run is worth 1% off the time, capped so a long gap cannot dominate the estimate.
FITNESS_TIME_PER_CTL_GAIN = 0.10
FITNESS_CAP = 0.03
#: Below this CTL the effort predates real fitness (the curve is still warming up).
FITNESS_MIN_CTL = 20.0
#: What race-morning form does to the time, as a multiplier.
FORM_FATIGUED_FACTOR = 1.02
FORM_FRESH_FACTOR = 0.99

CAVEATS = (
    "Only running kilometres are priced; gym, rides and anything else are left out.",
    "Kilometres are priced at your recent average load per km, so hard sessions and "
    "the race-pace long run cost more than the plan shows.",
    "Course, heat and the day itself are not modelled.",
)


def form_verdict(
    tsb: float, ctl_now: float | None = None, ctl_race: float | None = None
) -> dict[str, str]:
    """What a race-morning TSB means, with its own severity (the panel never guesses it
    from the wording).

    Fresh is only good news if the fitness is still there. Doing too little also gives a
    positive form, so when fitness is set to fall the verdict says so, whatever the form.
    """
    if (
        ctl_now is not None
        and ctl_race is not None
        and ctl_now >= FITNESS_MIN_CTL
        and ctl_race < ctl_now * FITNESS_LOSS
    ):
        return {
            "level": "warning",
            "text": f"Form {tsb:+.0f} on race morning, but fitness falls from "
            f"{ctl_now:.0f} to {ctl_race:.0f}: fresh because you are doing less "
            "than the plan, not because of the taper.",
        }
    if tsb < FATIGUED_BELOW:
        return {
            "level": "warning",
            "text": f"Form {tsb:+.0f} on race morning: still carrying fatigue. "
            "The taper is not enough to arrive fresh.",
        }
    if tsb < FRESH_LOW:
        return {
            "level": "good",
            "text": f"Form {tsb:+.0f} on race morning: neutral. "
            "A little more taper would leave you fresher.",
        }
    if tsb <= FRESH_HIGH:
        return {
            "level": "good",
            "text": f"Form {tsb:+.0f} on race morning: in the fresh window.",
        }
    return {
        "level": "warning",
        "text": f"Form {tsb:+.0f} on race morning: very fresh. The taper may be long "
        "enough to cost some fitness.",
    }


# ---------------------------------------------------------------------------
# Form forecast
# ---------------------------------------------------------------------------


def planned_loads(
    judged: Sequence[plan_mod.Judged],
    per_km: float,
    today: date,
    race_day: date,
    scale: float = 1.0,
) -> dict[str, float]:
    """Load per day for the sessions still to do, today through the day before the race.

    Only prescriptions that ask for running kilometres and have not happened yet. An
    optional session is left out rather than half counted, and so is a day the owner
    told the plan to ignore.
    """
    out: dict[str, float] = {}
    for item in judged:
        p = item.planned
        if p.sport != "running" or p.optional or p.ignored or item.verdict != "upcoming":
            continue
        day = date.fromisoformat(p.day)
        if day < today or day >= race_day:
            continue
        metres = plan_mod._target(p)
        if not metres:
            continue
        out[p.day] = out.get(p.day, 0.0) + metres / 1000.0 * per_km * scale
    return out


def project_form(
    loads: Mapping[str, float],
    future: Mapping[str, float],
    today: date,
    last_day: date,
) -> list[dict[str, float | str]]:
    """CTL/ATL/TSB from the first day of history through `last_day`.

    `future` replaces nothing: it is added to a day's actual load, which is how a
    session planned for later today sits on top of what has been done already.
    """
    merged = dict(loads)
    for day, load in future.items():
        merged[day] = merged.get(day, 0.0) + load
    start = date.fromisoformat(min(merged)) if merged else today
    return load_mod.load_curve(merged, start, last_day)


def recent_km_done_pct(
    store, judged: Sequence[plan_mod.Judged], today: date, days: int = 28
) -> float | None:
    """Running kilometres done as a share of the kilometres the plan asked for, over the
    last `days` before today.

    Volume rather than the plan's session score: a run that is the wrong length earns
    no credit there, though its load is just as real, and it is load being forecast.
    """
    lo = today - timedelta(days=days)
    planned_m = 0.0
    for item in judged:
        p = item.planned
        if p.sport != "running" or p.optional or p.ignored:
            continue
        if lo <= date.fromisoformat(p.day) < today:
            planned_m += plan_mod._target(p) or 0.0
    if planned_m <= 0:
        return None
    done_m = store.scalar(
        "SELECT SUM(distance_m) FROM v_activities_included "
        "WHERE activity_type = 'running' AND day >= ? AND day < ?",
        (lo.isoformat(), today.isoformat()),
    )
    return round(float(done_m or 0.0) / planned_m * 100.0, 1)


def compute_form_forecast(
    store, race: Mapping[str, Any], today: date, judged: Sequence[plan_mod.Judged] | None = None
) -> dict[str, Any] | None:
    """Fitness, fatigue and form from today to race morning, under the plan.

    None when there is nothing to price it with: no running history to set a load per
    kilometre, no load at all, or race day is today or past.
    """
    race_day = date.fromisoformat(race["date"])
    days_out = (race_day - today).days
    if days_out <= 0:
        return None
    per_km = plan_mod.load_per_km(store)
    loads = load_mod.daily_loads(store)
    if per_km is None or not loads:
        return None
    if judged is None:
        judged, _ = plan_mod.judge_all(store, today)

    km_done_pct = recent_km_done_pct(store, judged, today)
    scale = None if km_done_pct is None else max(0.0, min(km_done_pct / 100.0, 1.0))

    last_day = race_day - timedelta(days=1)
    as_planned = planned_loads(judged, per_km, today, race_day)
    history = {d: v for d, v in loads.items() if d <= today.isoformat()}
    plan_curve = project_form(history, as_planned, today, last_day)
    followed_curve = (
        None
        if scale is None
        else project_form(history, planned_loads(judged, per_km, today, race_day, scale), today, last_day)
    )

    today_key = today.isoformat()
    followed_by_day = {r["day"]: r for r in followed_curve or []}
    curve = []
    for row in plan_curve:
        if str(row["day"]) < today_key:
            continue
        other = followed_by_day.get(row["day"])
        curve.append(
            {
                "day": row["day"],
                "ctl": row["ctl"],
                "atl": row["atl"],
                "tsb": row["tsb"],
                "ctl_followed": None if other is None else other["ctl"],
                "atl_followed": None if other is None else other["atl"],
                "tsb_followed": None if other is None else other["tsb"],
            }
        )

    end = curve[-1]
    peak = max(curve, key=lambda r: float(r["ctl"]))
    # "Followed" is what the owner is likely to do, so it is the one the verdict judges
    # when there is one; the prescription itself is always shown beside it.
    basis = "followed" if followed_curve is not None else "plan"
    basis_tsb = float(end["tsb_followed"] if basis == "followed" else end["tsb"])
    planned_km = sum(
        (plan_mod._target(i.planned) or 0.0) / 1000.0
        for i in judged
        if i.planned.sport == "running"
        and not i.planned.optional
        and not i.planned.ignored
        and i.verdict == "upcoming"
        and today <= date.fromisoformat(i.planned.day) < race_day
    )
    return {
        "race_day": race["date"],
        "days_out": days_out,
        "load_per_km": per_km,
        "km_done_pct": km_done_pct,
        "planned_km_remaining": round(planned_km, 1),
        "curve": curve,
        "race_morning": {
            "day": end["day"],
            "ctl": end["ctl"],
            "atl": end["atl"],
            "tsb": end["tsb"],
            "ctl_followed": end["ctl_followed"],
            "atl_followed": end["atl_followed"],
            "tsb_followed": end["tsb_followed"],
            "form": load_mod.form_label(basis_tsb),
        },
        "peak": {"day": peak["day"], "ctl": peak["ctl"]},
        "basis": basis,
        "verdict": form_verdict(
            basis_tsb,
            float(curve[0]["ctl_followed"] if basis == "followed" else curve[0]["ctl"]),
            float(end["ctl_followed"] if basis == "followed" else end["ctl"]),
        ),
        "caveats": list(CAVEATS[:2]),
    }


# ---------------------------------------------------------------------------
# Finish-time range
# ---------------------------------------------------------------------------


def fitness_factor(ctl_then: float | None, ctl_race: float | None) -> float:
    """Multiplier on a projected time for the fitness gained since the effort."""
    if not ctl_then or ctl_race is None or ctl_then < FITNESS_MIN_CTL:
        return 1.0
    gain = ctl_race / ctl_then - 1.0
    return 1.0 - max(-FITNESS_CAP, min(FITNESS_TIME_PER_CTL_GAIN * gain, FITNESS_CAP))


def form_factor(tsb: float | None) -> float:
    """Multiplier for race-morning form: fatigued is slower, a fresh taper a touch faster."""
    if tsb is None:
        return 1.0
    if tsb < FATIGUED_BELOW:
        return FORM_FATIGUED_FACTOR
    if FRESH_LOW <= tsb <= FRESH_HIGH:
        return FORM_FRESH_FACTOR
    return 1.0


def _usable_efforts(bests: Sequence[Mapping[str, Any]], target_m: float) -> list[Mapping[str, Any]]:
    longish = [b for b in bests if MIN_SOURCE_M <= float(b["distance_m"]) <= target_m * 1.05]
    if longish:
        return longish
    # Nothing 5 km or longer: fall back to the longest effort there is, as the single
    # projection does, rather than refuse to answer.
    shorter = [b for b in bests if float(b["distance_m"]) <= target_m * 1.05]
    return [max(shorter, key=lambda b: float(b["distance_m"]))] if shorter else []


def project_range(
    efforts: Sequence[Mapping[str, Any]], target_m: float
) -> dict[str, Any] | None:
    """Fast, central and slow Riegel projections from several efforts.

    The central estimate weights each effort by how much of the target distance it
    covers, so a 10 k says more about a half than a 5 k does.
    """
    if not efforts:
        return None
    times = [
        perf.riegel(float(e["seconds"]), float(e["distance_m"]), target_m) for e in efforts
    ]
    weights = [float(e["distance_m"]) / target_m for e in efforts]
    central = sum(t * w for t, w in zip(times, weights)) / sum(weights)
    fast, slow = min(times), max(times)
    # Agreement between efforts is not certainty: the range always takes in the exponent
    # band on the longest effort, which is what a half marathon from a 10 k really risks.
    longest = max(efforts, key=lambda e: float(e["distance_m"]))
    lo = perf.riegel(float(longest["seconds"]), float(longest["distance_m"]), target_m, EXPONENT_BAND[0])
    hi = perf.riegel(float(longest["seconds"]), float(longest["distance_m"]), target_m, EXPONENT_BAND[1])
    widened = lo < fast or hi > slow
    fast, slow = min(fast, lo), max(slow, hi)
    return {"fast": fast, "central": central, "slow": slow, "widened": widened}


def compute_time_range(
    store,
    race: Mapping[str, Any],
    today: date,
    form: Mapping[str, Any] | None,
) -> dict[str, Any] | None:
    """Finish-time range for the goal race, raw and adjusted for fitness and form."""
    target_m = race.get("distance_m")
    if not target_m:
        return None
    bests = perf.personal_bests(store, since_day=perf._days_ago(store, 120)) or perf.personal_bests(store)
    efforts = _usable_efforts(bests, float(target_m))
    raw = project_range(efforts, float(target_m))
    if raw is None:
        return None

    # Fitness now and on race morning, from the same basis the verdict uses.
    ctl_race = None
    tsb_race = None
    basis = None
    if form is not None:
        morning = form["race_morning"]
        basis = form["basis"]
        followed = basis == "followed"
        ctl_race = float(morning["ctl_followed"] if followed else morning["ctl"])
        tsb_race = float(morning["tsb_followed"] if followed else morning["tsb"])

    loads = load_mod.daily_loads(store)
    ctl_by_day: dict[str, float] = {}
    if loads:
        history = load_mod.load_curve(loads, date.fromisoformat(min(loads)), today)
        ctl_by_day = {str(r["day"]): float(r["ctl"]) for r in history}

    f_form = form_factor(tsb_race)
    sources = []
    adjusted_times = []
    for e in efforts:
        projected = perf.riegel(float(e["seconds"]), float(e["distance_m"]), float(target_m))
        ctl_then = ctl_by_day.get(str(e["day"]))
        f_fit = fitness_factor(ctl_then, ctl_race)
        adjusted = projected * f_fit * f_form
        adjusted_times.append(adjusted)
        sources.append(
            {
                "label": e.get("label"),
                "distance_m": float(e["distance_m"]),
                "seconds": float(e["seconds"]),
                "day": str(e["day"]),
                "projected_seconds": round(projected, 1),
                "ctl_then": None if ctl_then is None else round(ctl_then, 1),
                "fitness_factor": round(f_fit, 4),
                "adjusted_seconds": round(adjusted, 1),
            }
        )

    # The same factors applied to the raw range, source by source for the fitness part:
    # the central fitness factor is the weighted mean of the sources', so the adjusted
    # central stays the weighted mean of the adjusted projections.
    weights = [float(e["distance_m"]) / float(target_m) for e in efforts]
    f_fit_central = sum(s["fitness_factor"] * w for s, w in zip(sources, weights)) / sum(weights)
    adjusted = {
        "fast": raw["fast"] * f_fit_central * f_form,
        "central": raw["central"] * f_fit_central * f_form,
        "slow": raw["slow"] * f_fit_central * f_form,
    }

    km = float(target_m) / 1000.0
    return {
        "distance_m": float(target_m),
        "raw": {k: round(raw[k], 1) for k in ("fast", "central", "slow")},
        "adjusted": {k: round(v, 1) for k, v in adjusted.items()},
        "central_pace_s_per_km": round(adjusted["central"] / km, 1),
        "fitness_pct": round((f_fit_central - 1.0) * 100.0, 2),
        "form_pct": round((f_form - 1.0) * 100.0, 2),
        "ctl_race": None if ctl_race is None else round(ctl_race, 1),
        "tsb_race": None if tsb_race is None else round(tsb_race, 1),
        "basis": basis,
        "sources": sources,
        "widened": bool(raw["widened"]),
        "caveats": [
            "The fitness and form adjustments are rules of thumb, not measurements; "
            "the unadjusted range is the data.",
            CAVEATS[2],
        ],
    }


#: How many weeks the taper check shows: the last full ones, then race week.
TAPER_WEEKS = 4


def compute_taper(
    judged: Sequence[plan_mod.Judged],
    race: Mapping[str, Any],
    form: Mapping[str, Any] | None,
) -> dict[str, Any] | None:
    """The plan's taper as written, and where it leaves form on race morning.

    This is the plan followed as prescribed, whatever has been run so far. Whether the
    taper itself is well made is a different question from whether the training reaches
    it, and the likely-line form beside it on the race card already answers that one.

    Weekly volume is the prescribed running, race week without the race itself: 21 km of
    race is not a week's training. Peak is the biggest full week before race week.
    """
    race_day = date.fromisoformat(race["date"])
    race_week = plan_mod.week_of(race["date"])
    by_week: dict[str, float] = {}
    for item in judged:
        p = item.planned
        if p.sport != "running" or p.kind == "race":
            continue
        week = plan_mod.week_of(p.day)
        if date.fromisoformat(plan_mod._monday(week)) > race_day:
            continue
        by_week[week] = by_week.get(week, 0.0) + (plan_mod._target(p) or 0.0) / 1000.0
    full_weeks = sorted(w for w in by_week if w < race_week)
    if form is None or not full_weeks:
        return None
    peak = max(by_week[w] for w in full_weeks)
    if peak <= 0:
        return None

    shown = [*full_weeks[-(TAPER_WEEKS - 1):], race_week]
    weeks = [
        {
            "start": plan_mod._monday(w),
            "planned_km": round(by_week.get(w, 0.0), 1),
            "pct_of_peak": round(100.0 * by_week.get(w, 0.0) / peak),
            "race_week": w == race_week,
        }
        for w in shown
    ]
    morning = form["race_morning"]
    now = form["curve"][0]
    tsb, ctl = float(morning["tsb"]), float(morning["ctl"])
    return {
        "peak_km": round(peak, 1),
        "weeks": weeks,
        "race_morning_tsb": round(tsb, 1),
        "race_morning_ctl": round(ctl, 1),
        "form": load_mod.form_label(tsb),
        "verdict": form_verdict(tsb, float(now["ctl"]), ctl),
    }


#: A long run older than this is history, not news.
LONG_RUN_LOOKBACK_DAYS = 14


def compute_long_run_note(
    judged: Sequence[plan_mod.Judged],
    today: date,
    race: Mapping[str, Any],
    per_km: float | None,
    time: Mapping[str, Any] | None,
) -> dict[str, Any] | None:
    """The last long run, if it was missed or cut short, and what that costs on race day.

    The most recent long run in the last fortnight is the one that counts: one done since
    clears the note. The cost is the fitness the shortfall would have added by race day,
    priced the way the finish range prices fitness, so it is as rough as that is: a rule
    of thumb. It is usually small, and saying so is the point. One run barely moves the
    finish; a habit of missing them does.
    """
    lo = today - timedelta(days=LONG_RUN_LOOKBACK_DAYS)
    past = [
        i
        for i in judged
        if i.planned.kind == "long"
        and i.planned.sport == "running"
        and not i.planned.optional
        and not i.planned.ignored
        and lo <= date.fromisoformat(i.planned.day) < today
    ]
    if not past:
        return None
    last = max(past, key=lambda i: i.planned.day)
    if last.verdict not in ("missed", "short"):
        return None

    # The least the plan asked for: what the verdict was judged against, so the note and
    # the week's own tile say the same number for the same run (`8-10 km` is 8, not 9).
    planned_m = last.planned.min_m or plan_mod._target(last.planned) or 0.0
    done_m = last.actual_m or 0.0
    shortfall_km = max(planned_m - done_m, 0.0) / 1000.0

    cost_seconds = None
    ctl_race = None if time is None else time.get("ctl_race")
    if per_km and time is not None and ctl_race:
        days_to_race = (date.fromisoformat(race["date"]) - date.fromisoformat(last.planned.day)).days
        ctl_lost = (
            shortfall_km * per_km
            * (1.0 - math.exp(-1.0 / load_mod.CTL_TAU_DAYS))
            * math.exp(-days_to_race / load_mod.CTL_TAU_DAYS)
        )
        share = min(FITNESS_TIME_PER_CTL_GAIN * ctl_lost / float(ctl_race), FITNESS_CAP)
        cost_seconds = round(float(time["adjusted"]["central"]) * share, 1)

    upcoming = [
        i
        for i in judged
        if i.planned.kind == "long"
        and i.planned.sport == "running"
        and not i.planned.optional
        and not i.planned.ignored
        and i.verdict == "upcoming"
        and date.fromisoformat(i.planned.day) >= today
    ]
    nxt = min(upcoming, key=lambda i: i.planned.day, default=None)
    return {
        "day": last.planned.day,
        "verdict": last.verdict,
        "planned_km": round(planned_m / 1000.0, 1),
        "done_km": round(done_m / 1000.0, 1),
        "shortfall_km": round(shortfall_km, 1),
        "cost_seconds": cost_seconds,
        "next_day": None if nxt is None else nxt.planned.day,
        "next_km": None if nxt is None else round((plan_mod._target(nxt.planned) or 0.0) / 1000.0, 1),
    }


def compute_forecast(store, today: date | None = None) -> dict[str, Any]:
    """Everything `/api/race/forecast` returns. Each half is null when it cannot be
    computed, so a calendar with a race but no distance still gets a form forecast."""
    today = today or date.today()
    race = plan_mod.goal_race(store, today)
    if race is None:
        return {
            "race": None, "today": today.isoformat(),
            "form": None, "time": None, "long_run": None, "taper": None,
        }
    judged, _ = plan_mod.judge_all(store, today)
    form = compute_form_forecast(store, race, today, judged)
    time = compute_time_range(store, race, today, form)
    per_km = None if form is None else float(form["load_per_km"])
    return {
        "race": race,
        "today": today.isoformat(),
        "form": form,
        "time": time,
        "long_run": compute_long_run_note(judged, today, race, per_km, time),
        "taper": compute_taper(judged, race, form),
    }
