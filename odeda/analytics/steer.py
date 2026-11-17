"""Where the owner stands against the plan, and what to do about it: `/api/plan/steer`.

The Plan page used to report on the past. This is its forward-looking answer: how far the
block has been followed, how long is left, which session matters most this week, and at
most two things that put the goal at risk, each with one plain line of advice.

Everything here is read from the plan's own judgement (`plan.judge_all`) and from the
kilometres the owner ran. The wording is the front end's; this returns the facts and a
stable code for each risk.
"""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any, Sequence

from . import forecast as forecast_mod
from . import plan as plan_mod

#: Share of the plan's running kilometres done over the last 28 days, and what it is
#: called. The same figure the race forecast prices the likely line with (D21).
AHEAD_PCT = 105.0
ON_TRACK_PCT = 85.0
BEHIND_PCT = 50.0

#: Missed prescribed running days within a week that read as a streak, not a bad day.
MISSED_STREAK = 3
STREAK_DAYS = 7
#: How far back a missed or cut-short long run still counts as a risk.
LONG_RUN_LOOKBACK_DAYS = 14
#: The most risks shown. The page steers; it does not list every missed session.
MAX_RISKS = 2


def standing(km_done_pct: float | None) -> str:
    """`ahead`, `on_track`, `behind`, `well_behind`, or `unknown` with no plan km to judge."""
    if km_done_pct is None:
        return "unknown"
    if km_done_pct >= AHEAD_PCT:
        return "ahead"
    if km_done_pct >= ON_TRACK_PCT:
        return "on_track"
    if km_done_pct >= BEHIND_PCT:
        return "behind"
    return "well_behind"


def key_session(judged: Sequence[plan_mod.Judged], today: date) -> dict[str, Any] | None:
    """This week's long run, whatever became of it; otherwise the next one still to come."""
    this_week = plan_mod.week_of(today.isoformat())
    longs = [
        j for j in judged
        if j.planned.kind == "long" and j.planned.sport == "running"
        and not j.planned.optional and not j.planned.ignored
    ]
    for item in sorted(longs, key=lambda j: j.planned.day):
        if plan_mod.week_of(item.planned.day) == this_week:
            return plan_mod._as_dict(item)
    ahead = [j for j in longs if j.verdict == "upcoming" and date.fromisoformat(j.planned.day) >= today]
    return plan_mod._as_dict(min(ahead, key=lambda j: j.planned.day)) if ahead else None


def risks(
    judged: Sequence[plan_mod.Judged], today: date, km_done_pct: float | None
) -> list[dict[str, Any]]:
    """What puts the race at risk, worst first, at most `MAX_RISKS`."""
    found: list[dict[str, Any]] = []

    if km_done_pct is not None and km_done_pct < BEHIND_PCT:
        found.append({"code": "volume_low", "severity": 3, "km_done_pct": km_done_pct})

    lo = today - timedelta(days=LONG_RUN_LOOKBACK_DAYS)
    cut = [
        j for j in judged
        if j.planned.kind == "long" and j.planned.sport == "running"
        and not j.planned.optional and not j.planned.ignored
        and j.verdict in ("missed", "short")
        and lo <= date.fromisoformat(j.planned.day) < today
    ]
    if cut:
        last = max(cut, key=lambda j: j.planned.day)
        found.append({"code": "long_run_cut", "severity": 2, "day": last.planned.day,
                      "verdict": last.verdict})

    week_ago = today - timedelta(days=STREAK_DAYS)
    missed = [
        j for j in judged
        if j.planned.sport == "running" and j.verdict == "missed"
        and not j.planned.optional and not j.planned.ignored
        and week_ago <= date.fromisoformat(j.planned.day) < today
    ]
    if len(missed) >= MISSED_STREAK:
        found.append({"code": "missed_streak", "severity": 1, "count": len(missed)})

    found.sort(key=lambda r: -int(r["severity"]))
    return found[:MAX_RISKS]


def compute_steer(store, today: date | None = None) -> dict[str, Any]:
    """The page's top answer. No race ahead and no plan are both answers, not errors."""
    today = today or date.today()
    judged, _ = plan_mod.judge_all(store, today)
    race = plan_mod.goal_race(store, today)

    km_pct = forecast_mod.recent_km_done_pct(store, judged, today)
    days_to_go = None if race is None else (date.fromisoformat(race["date"]) - today).days

    return {
        "today": today.isoformat(),
        "race": None if race is None else {
            "name": race["name"],
            "date": race["date"],
            "days_to_go": days_to_go,
            "weeks_to_go": None if days_to_go is None else round(days_to_go / 7.0, 1),
        },
        "standing": standing(km_pct),
        "km_done_pct": km_pct,
        "key_session": key_session(judged, today),
        "risks": risks(judged, today, km_pct),
    }
