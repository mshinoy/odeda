"""Did the training happen, and is it still the plan it was meant to be.

Three ideas shape this module, and all three came from the owner rather than from me.

**A day prescribes one session per sport, not one per calendar event.** The club's
Friday entry says *where and when* the long run happens; the Higdon entry says *how
far*. They are one run described twice, and treating them as competing demands marks a
run the owner did as a run they missed. Where a day's events disagree, the more specific
one wins — a dated one-off beats an instance of a recurring series, so a taper week's
`W12: Run 3.2 km` beats the club series' standing `8-10 km` (D13).

**Running further than prescribed is not a deviation.** What actually gets run varies
with how the morning goes. A tracker that frowns at a long run for being long is
measuring the wrong thing, so there is no `over` verdict: meeting or beating the target
is `done`, and the surplus is recorded because it matters to load, never as a mark
against the athlete.

**A ride on a run day is a substitution, not two failures.** Keying the match on sport
would score it as the run missed *plus* an unplanned ride, which is the app arguing with
someone about a session they did. The swap is recorded with both sports side by side and
left unscored: there are conversion rules for this — three kilometres ridden to one run
— and they are guesswork with arithmetic on top. Burying a ratio here would put it
invisibly into every weekly number. The honest axis is load, which the app already
computes per activity and which is sport-neutral by construction, and that comparison
is made where it can be seen rather than folded into an adherence percentage.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Any, Iterable, Mapping, Sequence

from ..plan import parse as P

#: Sports that can stand in for one another. A gym session is not an endurance
#: substitute for a long run and is never matched to one.
ENDURANCE = frozenset({P.SPORT_RUN, P.SPORT_RIDE, "swimming", "walking"})

#: Garmin's type names, mapped onto the plan's vocabulary.
ACTIVITY_SPORT = {
    "running": P.SPORT_RUN,
    "treadmill_running": P.SPORT_RUN,
    "trail_running": P.SPORT_RUN,
    "walking": "walking",
    "cycling": P.SPORT_RIDE,
    "indoor_cycling": P.SPORT_RIDE,
    "swimming": "swimming",
    "strength": P.SPORT_GYM,
}

#: A session may be fulfilled a day late. Longer than this and it is a different
#: session: a Friday long run done on Sunday did not rescue Friday, it replaced the
#: rest day.
MOVE_TOLERANCE_DAYS = 1

#: Not every session weighs the same. The owner's plan holds weekly volume nearly flat
#: at 28-36 km while the long run climbs from 14 km to 20 km, so the long run is close
#: to the entire training stimulus and an unweighted percentage would hide missing it
#: behind three easy sessions that happened.
KIND_WEIGHT = {
    "race": 5.0,
    "long": 3.0,
    "quality": 2.0,
    "easy": 1.0,
    "cross": 0.5,
    "gym": 1.0,
    "rest": 0.5,
}
DEFAULT_WEIGHT = 1.0

VERDICTS = ("done", "short", "missed", "substituted", "rest-kept", "rest-broken", "upcoming")


@dataclass
class PlannedDay:
    """What one day asks for, after its events have been collapsed."""

    day: str
    sport: str | None
    kind: str | None
    min_m: float | None
    max_m: float | None
    optional: bool
    title: str
    session_ids: list[int] = field(default_factory=list)

    @property
    def weight(self) -> float:
        if self.optional:
            return 0.0
        return KIND_WEIGHT.get(self.kind or "", DEFAULT_WEIGHT)


@dataclass
class Judged:
    """A prescribed day, and what became of it."""

    planned: PlannedDay
    verdict: str
    activity_id: str | None = None
    actual_sport: str | None = None
    actual_m: float | None = None
    actual_s: float | None = None
    moved_from: str | None = None

    @property
    def counts(self) -> bool:
        """Whether this day contributes to an adherence figure at all.

        An optional session does not: counting a skipped optional spin as a miss makes
        the plan punish the owner for following it. Nor does a day still in the future.
        """
        return not self.planned.optional and self.verdict != "upcoming"

    @property
    def credited(self) -> bool:
        return self.verdict in ("done", "rest-kept")


# ---------------------------------------------------------------------------
# Collapsing events into days
# ---------------------------------------------------------------------------


def collapse(sessions: Sequence[Mapping[str, Any]]) -> list[PlannedDay]:
    """One `PlannedDay` per (day, sport). D13: the more specific event wins.

    Specificity, most specific first: an event that states its own distance, then a
    one-off, then an instance of a recurring series. A session carrying a `GA:` hint is
    always most specific, because it was written to settle exactly this.
    """
    grouped: dict[tuple[str, str | None], list[Mapping[str, Any]]] = defaultdict(list)
    for row in sessions:
        grouped[(str(row["day"]), row.get("sport"))].append(row)

    out: list[PlannedDay] = []
    for (day, sport), rows in sorted(grouped.items(), key=lambda kv: (kv[0][0], kv[0][1] or "")):
        rows = sorted(rows, key=_specificity)
        best = rows[0]
        out.append(
            PlannedDay(
                day=day,
                sport=sport,
                kind=next((r.get("kind") for r in rows if r.get("kind")), None),
                min_m=best.get("planned_min_m"),
                max_m=best.get("planned_max_m"),
                # Optional only when *every* event for that day says so; one firm
                # session on a day is a session owed.
                optional=all(bool(r.get("optional")) for r in rows),
                title=str(best.get("title") or ""),
                session_ids=[int(r["id"]) for r in rows if r.get("id") is not None],
            )
        )
    return out


def _specificity(row: Mapping[str, Any]) -> tuple[int, int, str]:
    source = str(row.get("source") or "")
    has_distance = row.get("planned_min_m") is not None
    recurring = bool(row.get("recurring"))
    return (
        0 if source == "hint" else 1,
        (0 if has_distance else 1) * 2 + (1 if recurring else 0),
        str(row.get("title") or ""),
    )


# ---------------------------------------------------------------------------
# Matching
# ---------------------------------------------------------------------------


def match(
    days: Sequence[PlannedDay],
    activities: Sequence[Mapping[str, Any]],
    today: date | None = None,
    manual: Mapping[int, str] | None = None,
) -> tuple[list[Judged], list[Mapping[str, Any]]]:
    """Judge every prescribed day, and return what was left over.

    Returns `(judged, unplanned)` — the second being activities no prescription claimed,
    which are not failures and are shown as what they are.
    """
    today = today or date.today()
    manual = manual or {}
    by_day: dict[str, list[Mapping[str, Any]]] = defaultdict(list)
    for a in activities:
        by_day[str(a["day"])].append(a)

    claimed: set[str] = set()
    judged: list[Judged] = []

    # Exact-day matches first, across every day, before anything is allowed to reach
    # into a neighbouring day. Otherwise Thursday's gym could claim Friday's run while
    # Friday's own activity sat unmatched beside it.
    # Rest days are settled last. A rest day claims *any* activity on it — that is what
    # breaking the rest means — so letting one go first could take the activity a real
    # prescription on the same day was waiting for.
    verdict_by_day: dict[int, Judged] = {}
    order = sorted(range(len(days)), key=lambda i: days[i].sport == P.SPORT_REST)
    for i in order:
        planned = days[i]
        chosen = _claim(planned, by_day.get(planned.day, []), claimed, manual)
        verdict_by_day[i] = _judge(planned, chosen, today, moved_from=None)
    judged = [verdict_by_day[i] for i in range(len(days))]

    for item in judged:
        if item.activity_id is not None or item.planned.sport in (P.SPORT_REST, None):
            continue
        day = date.fromisoformat(item.planned.day)
        for offset in range(1, MOVE_TOLERANCE_DAYS + 1):
            for other in (day + timedelta(days=offset), day - timedelta(days=offset)):
                key = other.isoformat()
                # Only reach into a day the plan did not itself spend.
                if any(d.day == key and d.sport == item.planned.sport for d in days):
                    continue
                chosen = _claim(item.planned, by_day.get(key, []), claimed, manual)
                if chosen is not None:
                    moved = _judge(item.planned, chosen, today, moved_from=key)
                    item.verdict = moved.verdict
                    item.activity_id = moved.activity_id
                    item.actual_sport = moved.actual_sport
                    item.actual_m = moved.actual_m
                    item.actual_s = moved.actual_s
                    item.moved_from = key
                    break
            if item.activity_id is not None:
                break

    unplanned = [a for a in activities if str(a["activity_id"]) not in claimed]
    return judged, unplanned


def _claim(
    planned: PlannedDay,
    candidates: Sequence[Mapping[str, Any]],
    claimed: set[str],
    manual: Mapping[int, str],
) -> Mapping[str, Any] | None:
    """Pick the activity that fulfils this prescription, and mark it spent."""
    forced = next((manual[s] for s in planned.session_ids if s in manual), None)
    if forced is not None:
        for a in candidates:
            if str(a["activity_id"]) == forced:
                claimed.add(forced)
                return a

    free = [a for a in candidates if str(a["activity_id"]) not in claimed]
    if not free:
        return None

    if planned.sport == P.SPORT_REST:
        # Anything at all breaks a rest day, including a gym session. The activity is
        # claimed so it is reported as the thing that broke the rest rather than
        # appearing a second time as an unplanned session.
        best = max(free, key=lambda a: float(a.get("duration_s") or 0))
        claimed.add(str(best["activity_id"]))
        return best

    same = [a for a in free if _sport_of(a) == planned.sport]
    pool = same
    if not pool and planned.sport in ENDURANCE:
        # The substitution case: a ride on a run day. Gym sessions are excluded, so a
        # Monday lift never stands in for a Monday run.
        pool = [a for a in free if _sport_of(a) in ENDURANCE]
    if not pool:
        return None

    # The longest effort is the one that answers the prescription; a 2 km warm-up
    # logged beside an 18 km long run should not be what Friday gets credited with.
    best = max(pool, key=lambda a: float(a.get("distance_m") or 0) or float(a.get("duration_s") or 0))
    claimed.add(str(best["activity_id"]))
    return best


def _sport_of(activity: Mapping[str, Any]) -> str | None:
    return ACTIVITY_SPORT.get(str(activity.get("activity_type") or ""))


def _judge(
    planned: PlannedDay,
    activity: Mapping[str, Any] | None,
    today: date,
    moved_from: str | None,
) -> Judged:
    day = date.fromisoformat(planned.day)

    if planned.sport == P.SPORT_REST:
        if activity is not None:
            return Judged(planned, "rest-broken", str(activity["activity_id"]),
                          _sport_of(activity), float(activity.get("distance_m") or 0) or None)
        return Judged(planned, "upcoming" if day > today else "rest-kept")

    if activity is None:
        return Judged(planned, "upcoming" if day >= today else "missed")

    actual_sport = _sport_of(activity)
    distance = float(activity.get("distance_m") or 0) or None
    duration = float(activity.get("duration_s") or 0) or None

    if actual_sport != planned.sport:
        return Judged(planned, "substituted", str(activity["activity_id"]),
                      actual_sport, distance, duration, moved_from)

    verdict = "done"
    if planned.min_m is not None and distance is not None and distance < planned.min_m:
        # A hair under is not a failure; GPS alone moves a long run by tens of metres.
        verdict = "short" if distance < planned.min_m * 0.95 else "done"

    return Judged(planned, verdict, str(activity["activity_id"]),
                  actual_sport, distance, duration, moved_from)


# ---------------------------------------------------------------------------
# Scoring
# ---------------------------------------------------------------------------


def week_of(day: str) -> str:
    y, w, _ = date.fromisoformat(day).isocalendar()
    return f"{y}-W{w:02d}"


def weekly(judged: Sequence[Judged]) -> list[dict[str, Any]]:
    """Per-week totals. Adherence is weighted, because the sessions are not equal."""
    buckets: dict[str, list[Judged]] = defaultdict(list)
    for item in judged:
        buckets[week_of(item.planned.day)].append(item)

    out: list[dict[str, Any]] = []
    for week in sorted(buckets):
        items = buckets[week]
        counted = [i for i in items if i.counts]
        weight = sum(i.planned.weight for i in counted)
        earned = sum(i.planned.weight for i in counted if i.credited)
        planned_m = sum(_target(i.planned) or 0 for i in items if i.planned.sport == P.SPORT_RUN)
        actual_m = sum(
            i.actual_m or 0
            for i in items
            if i.actual_sport == P.SPORT_RUN and i.actual_m
        )
        long_run = next((i for i in items if i.planned.kind in ("long", "race")), None)
        out.append(
            {
                "week": week,
                "start": _monday(week),
                "sessions_planned": len(counted),
                "sessions_done": sum(1 for i in counted if i.credited),
                "adherence_pct": round(100.0 * earned / weight, 1) if weight else None,
                "planned_km": round(planned_m / 1000.0, 1),
                "actual_km": round(actual_m / 1000.0, 1),
                "long_run": None if long_run is None else long_run.verdict,
                "substitutions": sum(1 for i in items if i.verdict == "substituted"),
            }
        )
    return out


def _target(planned: PlannedDay) -> float | None:
    """The midpoint of a range. `8-10 km` is one prescription, not two, and summing a
    week needs a single number; the band is kept on the day for judging."""
    if planned.min_m is None:
        return None
    if planned.max_m is None or planned.max_m == planned.min_m:
        return planned.min_m
    return (planned.min_m + planned.max_m) / 2.0


def _monday(week: str) -> str:
    year, _, num = week.partition("-W")
    return date.fromisocalendar(int(year), int(num), 1).isoformat()


def rolling_adherence(weeks: Sequence[Mapping[str, Any]], window: int = 4) -> float | None:
    """Weighted adherence over the last `window` weeks that had anything prescribed."""
    usable = [w for w in weeks if w.get("adherence_pct") is not None][-window:]
    if not usable:
        return None
    return round(sum(float(w["adherence_pct"]) for w in usable) / len(usable), 1)
