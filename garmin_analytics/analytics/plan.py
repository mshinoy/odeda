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

import re
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Any, Collection, Iterable, Mapping, Sequence

from .. import config
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
    # Ingestion stores a lift as `strength_training`. `strength` alone matched nothing
    # real, so every gym session read as missed and as an unplanned extra.
    "strength_training": P.SPORT_GYM,
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

#: How far ahead the plan is shown when the calendar names no race. Ingest expands
#: recurrence much further (it has to find a race before it can stop at one), but a
#: weekly club run with no race ahead of it would otherwise fill the view with a year
#: of identical weeks.
VIEW_HORIZON_DAYS = 180

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
    #: The owner said this day does not count. Unlike `optional`, which is the
    #: calendar's own word, this is a decision they made afterwards.
    ignored: bool = False
    #: The owner moved it or changed its distance (`plan_edits`), or wrote it themselves.
    edited: bool = False
    own: bool = False
    #: The calendar's day, when the owner moved the session off it.
    original_day: str | None = None

    @property
    def weight(self) -> float:
        if self.optional or self.ignored:
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
        the plan punish the owner for following it. Nor does a day still in the future,
        nor one the owner has said to ignore.
        """
        return (
            not self.planned.optional
            and not self.planned.ignored
            and self.verdict != "upcoming"
        )

    @property
    def credited(self) -> bool:
        return self.verdict in ("done", "rest-kept")


# ---------------------------------------------------------------------------
# Collapsing events into days
# ---------------------------------------------------------------------------


def collapse(
    sessions: Sequence[Mapping[str, Any]],
    ignored: Collection[int] = (),
) -> list[PlannedDay]:
    """One `PlannedDay` per (day, sport). D13: the more specific event wins.

    Specificity, most specific first: an event that states its own distance, then a
    one-off, then an instance of a recurring series. A session carrying a `GA:` hint is
    always most specific, because it was written to settle exactly this.

    `ignored` holds the plan_session ids the owner has struck out. One is enough: the
    events on a day are one prescription described several times, so ignoring any of
    them ignores the day.
    """
    ignored = set(ignored)
    grouped: dict[tuple[str, str | None], list[Mapping[str, Any]]] = defaultdict(list)
    for row in sessions:
        grouped[(str(row["day"]), row.get("sport"))].append(row)

    out: list[PlannedDay] = []
    for (day, sport), rows in sorted(grouped.items(), key=lambda kv: (kv[0][0], kv[0][1] or "")):
        rows = sorted(rows, key=_specificity)
        best = rows[0]
        ids = [int(r["id"]) for r in rows if r.get("id") is not None]
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
                session_ids=ids,
                ignored=any(i in ignored for i in ids),
                edited=any(bool(r.get("edited")) for r in rows),
                own=any(bool(r.get("own")) for r in rows),
                original_day=next((r.get("original_day") for r in rows if r.get("original_day")), None),
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
    """Per-week totals. Adherence is weighted, because the sessions are not equal.

    Two session counts, deliberately, because two different questions get asked of a
    week and one number cannot answer both:

    * `sessions_prescribed` — everything the week asks for, over the same days as
      `planned_km`. These two are the pair to show together.
    * `sessions_planned` — only what can be judged yet: `counts` drops an optional
      session, one the owner ignored, and any day still to come. This is adherence's
      denominator, and on Tuesday it is smaller than the week.

    They were previously shown as a pair, so a half-finished week read `1 of 6 sessions ·
    11.3 of 30.0 km` with the 6 covering days so far and the 30.0 covering all seven.
    `planned_km` cannot follow `counts` instead: `targets` takes the plan's **peak** week
    from it, and a build's peak is in the future, so a due-only sum would report the
    biggest week run so far and creep upwards every week (30 km plan → 18 km target).
    """
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
                "sessions_prescribed": len(items),
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


# ---------------------------------------------------------------------------
# Store-backed
# ---------------------------------------------------------------------------


def _sessions(store, start: str | None = None, end: str | None = None) -> list[dict[str, Any]]:
    """The live sessions, with the owner's edits read on top of the calendar's.

    The filters are on the day *as edited*: a session moved into the window belongs to it,
    and one moved out does not, whatever the calendar says.
    """
    day = "COALESCE(e.day, s.day)"
    sql = (
        f"SELECT s.id, {day} AS day, s.sport, s.kind, "
        "       COALESCE(e.planned_m, s.planned_min_m) AS planned_min_m, "
        "       COALESCE(e.planned_m, s.planned_max_m) AS planned_max_m, "
        "       s.title, s.recurring, s.optional, s.parse_source AS source, s.parse_status, "
        "       (e.plan_session_id IS NOT NULL) AS edited, "
        "       (s.uid LIKE 'own:%') AS own, "
        "       CASE WHEN e.day IS NOT NULL AND e.day <> s.day THEN s.day END AS original_day "
        "FROM plan_sessions s LEFT JOIN plan_edits e ON e.plan_session_id = s.id "
        "WHERE s.withdrawn_at IS NULL"
    )
    params: list[Any] = []
    if start:
        sql += f" AND {day} >= ?"
        params.append(start)
    if end:
        sql += f" AND {day} <= ?"
        params.append(end)
    return store.query(sql + f" ORDER BY {day}, s.start_local", params)


def _activities(store, start: str | None = None, end: str | None = None) -> list[dict[str, Any]]:
    """From `v_activities_included`, so an activity the owner retyped is matched on its
    *effective* type and one excluded from stats cannot fulfil a session."""
    sql = (
        "SELECT activity_id, day, activity_type, activity_name, distance_m, "
        "       duration_s, moving_time_s, trimp "
        "FROM v_activities_included WHERE 1 = 1"
    )
    params: list[Any] = []
    if start:
        sql += " AND day >= ?"
        params.append(start)
    if end:
        sql += " AND day <= ?"
        params.append(end)
    return store.query(sql + " ORDER BY day", params)


def _manual_links(store) -> dict[int, str]:
    return {
        int(r["plan_session_id"]): str(r["activity_id"])
        for r in store.query(
            "SELECT plan_session_id, activity_id FROM plan_links "
            "WHERE link_type = 'manual' AND activity_id IS NOT NULL"
        )
    }


def _ignored_links(store) -> set[int]:
    """The sessions the owner has struck out. Both decisions are read, not just one."""
    return {
        int(r["plan_session_id"])
        for r in store.query(
            "SELECT plan_session_id FROM plan_links WHERE link_type = 'ignored'"
        )
    }


def plan_start_day(store) -> str | None:
    """The day the owner says this block began, or None for the whole calendar.

    Read here, at the one place every figure is built from, so that weeks, adherence,
    targets and the next session cannot disagree about where the plan starts.
    """
    from ..ingest import plan_ics

    source = plan_ics.get_source(store)
    if source is None:
        return None
    day = source["start_day"]
    return None if day is None else str(day)


def judge_all(store, today: date | None = None) -> tuple[list[Judged], list[dict[str, Any]]]:
    # Bounded at both ends: the owner's start day below (T49), and a week past the
    # goal race above. Ingest expands recurrence on a generous horizon because it has
    # to find the race before it can be bounded by it; the plan the owner *reads*
    # still ends when the block does, rather than running a year of club runs on.
    today = today or date.today()
    race = goal_race(store, today)
    last = (
        date.fromisoformat(race["date"]) + timedelta(days=7)
        if race is not None
        else today + timedelta(days=VIEW_HORIZON_DAYS)
    )
    end = last.isoformat()
    sessions = _sessions(store, start=plan_start_day(store), end=end)
    if not sessions:
        return [], []
    lo = min(str(s["day"]) for s in sessions)
    hi = max(str(s["day"]) for s in sessions)
    window_lo = (date.fromisoformat(lo) - timedelta(days=MOVE_TOLERANCE_DAYS)).isoformat()
    window_hi = (date.fromisoformat(hi) + timedelta(days=MOVE_TOLERANCE_DAYS)).isoformat()
    return match(
        collapse(sessions, _ignored_links(store)),
        _activities(store, window_lo, window_hi),
        today=today,
        manual=_manual_links(store),
    )


def _as_dict(item: Judged) -> dict[str, Any]:
    p = item.planned
    return {
        "day": p.day,
        "sport": p.sport,
        "kind": p.kind,
        "planned_min_m": p.min_m,
        "planned_max_m": p.max_m,
        "title": p.title,
        "optional": p.optional,
        "ignored": p.ignored,
        "session_ids": p.session_ids,
        "verdict": item.verdict,
        "activity_id": item.activity_id,
        "actual_sport": item.actual_sport,
        "actual_m": item.actual_m,
        "actual_s": item.actual_s,
        "moved_from": item.moved_from,
        "edited": p.edited,
        "own": p.own,
        "original_day": p.original_day,
    }


def compute_plan(store, today: date | None = None) -> dict[str, Any]:
    """Everything `/api/plan` needs. No calendar subscribed is an empty plan, not an
    error: the endpoint answers 200 with `subscribed: false` and the UI says what to do."""
    from ..ingest import plan_ics

    today = today or date.today()
    source = plan_ics.get_source(store)
    judged, unplanned = judge_all(store, today)
    weeks = weekly(judged)

    unreadable = store.query(
        "SELECT id, day, title, description, parse_status FROM plan_sessions "
        "WHERE withdrawn_at IS NULL AND parse_status IN ('unparsed', 'unsupported_rrule') "
        "ORDER BY day"
    )
    return {
        "subscribed": source is not None,
        "source": None if source is None else {
            "label": source["label"],
            "url_masked": plan_ics.mask_url(str(source["url"])),
            "last_fetch_at": source["last_fetch_at"],
            "last_error": source["last_error"],
            "start_day": source["start_day"],
        },
        "today": today.isoformat(),
        "weeks": weeks,
        "adherence_4wk": rolling_adherence(weeks),
        "this_week": next(
            (w for w in weeks if w["week"] == week_of(today.isoformat())), None
        ),
        "next_session": _next_session(judged, today),
        "decisions": decisions(store),
        "targets": targets(judged, store),
        "unreadable": unreadable,
        "unplanned": unplanned[-20:],
    }


def compute_week(store, start: str, today: date | None = None) -> dict[str, Any]:
    """One week, session by session, with whatever fulfilled each."""
    today = today or date.today()
    judged, unplanned = judge_all(store, today)
    week = week_of(start)
    days = [_as_dict(j) for j in judged if week_of(j.planned.day) == week]
    summary = next((w for w in weekly(judged) if w["week"] == week), None)
    return {
        "week": week,
        "start": _monday(week),
        "summary": summary,
        "sessions": days,
        "unplanned": [a for a in unplanned if week_of(str(a["day"])) == week],
    }


def compute_sessions(store, today: date | None = None) -> dict[str, Any]:
    """Every judged session in the plan, in one answer.

    The calendar draws a cell per day across the whole block. `/api/plan` carries week
    *summaries* and `/api/plan/week` carries one week, so without this a twenty-one week
    view would be twenty-one requests. It judges through `judge_all` like everything
    else, so a cell and the week summary above it cannot disagree about a verdict.
    """
    today = today or date.today()
    judged, unplanned = judge_all(store, today)
    return {
        "today": today.isoformat(),
        "sessions": [_as_dict(j) for j in judged],
        "unplanned": unplanned,
    }


def _next_session(judged: Sequence[Judged], today: date) -> dict[str, Any] | None:
    upcoming = [
        j for j in judged
        if j.verdict == "upcoming" and j.planned.sport != P.SPORT_REST
        and date.fromisoformat(j.planned.day) >= today
    ]
    if not upcoming:
        return None
    return _as_dict(min(upcoming, key=lambda j: j.planned.day))


#: How many days of the owner's own running the load-per-kilometre is read from. Long
#: enough to average out one hard week, short enough to be this block's fitness rather
#: than last year's.
LOAD_SAMPLE_DAYS = 90


def load_per_km(store, days: int = LOAD_SAMPLE_DAYS) -> float | None:
    """TRIMP per kilometre over the owner's last `days` of running.

    This is the exchange rate that turns the plan's kilometres into a CTL, and it is
    the reason the CTL target can be called derived rather than invented: the same
    kilometre costs a different load at a different fitness, in a different month, in
    Doha. Theirs is the only honest source for it.
    """
    hi = store.scalar("SELECT MAX(day) FROM v_activities_included")
    if not hi:
        return None
    lo = (date.fromisoformat(str(hi)) - timedelta(days=days - 1)).isoformat()
    rows = store.query(
        "SELECT SUM(COALESCE(trimp, 0)) AS load, SUM(COALESCE(distance_m, 0)) AS dist "
        "FROM v_activities_included "
        "WHERE activity_type = 'running' AND day BETWEEN ? AND ?",
        (lo, hi),
    )
    total_load = float(rows[0]["load"] or 0.0)
    total_km = float(rows[0]["dist"] or 0.0) / 1000.0
    if total_load <= 0 or total_km <= 0:
        return None
    return round(total_load / total_km, 2)


def targets(judged: Sequence[Judged], store: Any | None = None) -> dict[str, Any]:
    """The plan's own peak, replacing the constants an agent invented (D12).

    `TARGET_PEAK_WEEKLY_KM` was 55 against a plan that never asks for more than 36, so
    the race panel warned "a long way short" on weeks followed exactly. With no plan
    loaded these are `None` and the panel shows its curves without a goal line, which is
    honest in a way an invented number is not.

    The CTL target is the plan's peak week priced in the owner's own load per kilometre.
    CTL is a 42-day average of daily load, so a week held at the peak settles at
    `peak_km * load_per_km / 7` — no constant anywhere in it. It needs a `store`,
    because the price comes from their training and not from the calendar; without one,
    or with no running to read, the plan's kilometres stand on their own.
    """
    weeks = weekly(judged)
    planned = [float(w["planned_km"]) for w in weeks if w["planned_km"]]
    if not planned:
        return {
            "peak_weekly_km": None,
            "mean_weekly_km": None,
            "ctl_target": None,
            "load_per_km": None,
            "source": "none",
        }
    peak = round(max(planned), 1)
    per_km = load_per_km(store) if store is not None else None
    return {
        "peak_weekly_km": peak,
        "mean_weekly_km": round(sum(planned) / len(planned), 1),
        "ctl_target": None if per_km is None else round(peak * per_km / 7.0, 1),
        "load_per_km": per_km,
        "source": "plan",
    }


def race_targets(store, today: date | None = None) -> dict[str, Any]:
    """`targets`, read from the database: what the race panel is allowed to aim at."""
    judged, _ = judge_all(store, today)
    return targets(judged, store)


def decisions(store) -> list[dict[str, Any]]:
    """Every match the owner has overruled by hand, so Settings can list and undo them.

    These are the only two things in the whole plan that are stored rather than
    recomputed, which is exactly why they need somewhere to be seen: an `auto` match
    that goes wrong fixes itself on the next read, and one of these never does.
    """
    rows = store.query(
        "SELECT l.plan_session_id AS id, l.link_type, l.activity_id, l.linked_at, "
        "       s.day, s.title "
        "FROM plan_links l JOIN plan_sessions s ON s.id = l.plan_session_id "
        "WHERE l.link_type IN ('manual', 'ignored') "
        "ORDER BY s.day"
    )
    return [
        {
            "plan_session_id": int(r["id"]),
            "day": str(r["day"]),
            "title": r["title"],
            "link_type": str(r["link_type"]),
            "activity_id": r["activity_id"],
            "linked_at": r["linked_at"],
        }
        for r in rows
    ]


def set_link(store, session_id: int, activity_id: str | None, ignore: bool) -> dict[str, Any]:
    """Record the owner's own decision about a session.

    Only `manual` and `ignored` are stored. `auto` matches are the matcher's output and
    are recomputed every read, so retyping an activity moves its match with it — storing
    them would freeze a judgement that is supposed to follow the data.
    """
    from ..db.store import utcnow

    exists = store.scalar("SELECT id FROM plan_sessions WHERE id = ?", (session_id,))
    if exists is None:
        raise LookupError(f"no plan session {session_id}")

    if ignore:
        with store.tx():
            store.conn.execute(
                "INSERT INTO plan_links (plan_session_id, activity_id, link_type, linked_at) "
                "VALUES (?, NULL, 'ignored', ?) "
                "ON CONFLICT (plan_session_id) DO UPDATE SET "
                "activity_id = NULL, link_type = 'ignored', linked_at = excluded.linked_at",
                (session_id, utcnow()),
            )
        return {"plan_session_id": session_id, "activity_id": None, "link_type": "ignored"}

    if activity_id is None:
        return clear_link(store, session_id)

    if store.scalar("SELECT activity_id FROM activities WHERE activity_id = ?", (activity_id,)) is None:
        raise LookupError(f"no activity {activity_id}")

    taken = store.scalar(
        "SELECT plan_session_id FROM plan_links WHERE activity_id = ? AND plan_session_id <> ?",
        (activity_id, session_id),
    )
    if taken is not None:
        # The database would refuse this anyway; saying which session holds it is more
        # use than a constraint violation.
        raise ValueError(f"activity {activity_id} is already linked to session {taken}")

    with store.tx():
        store.conn.execute(
            "INSERT INTO plan_links (plan_session_id, activity_id, link_type, linked_at) "
            "VALUES (?, ?, 'manual', ?) "
            "ON CONFLICT (plan_session_id) DO UPDATE SET "
            "activity_id = excluded.activity_id, link_type = 'manual', "
            "linked_at = excluded.linked_at",
            (session_id, activity_id, utcnow()),
        )
    return {"plan_session_id": session_id, "activity_id": activity_id, "link_type": "manual"}


def clear_link(store, session_id: int) -> dict[str, Any]:
    with store.tx():
        store.conn.execute("DELETE FROM plan_links WHERE plan_session_id = ?", (session_id,))
    return {"plan_session_id": session_id, "activity_id": None, "link_type": "cleared"}


# ---------------------------------------------------------------------------
# The owner's own changes to the plan
# ---------------------------------------------------------------------------

OWN_SPORTS = ("running", "cycling", "strength", "swimming", "walking")
#: The kind a session of the owner's own gets when they do not say; it decides how the
#: session is weighted and what it is called.
OWN_KINDS = {"running": "easy", "cycling": "cross", "strength": "gym", "swimming": "cross", "walking": "cross"}


def _check_day(day: str) -> str:
    try:
        return date.fromisoformat(day).isoformat()
    except ValueError as exc:
        raise ValueError(f"not a day: {day!r}") from exc


def edit_session(
    store, session_id: int, day: str | None = None, distance_m: float | None = None
) -> dict[str, Any]:
    """Move a calendar session to another day, and/or ask for a different distance.

    Kept in `plan_edits`, read on top of the calendar and never overwritten by a sync.
    Asking for what the calendar already says is not an edit, so it clears one.
    """
    from ..db.store import utcnow

    row = store.query("SELECT day, planned_min_m FROM plan_sessions WHERE id = ?", (session_id,))
    if not row:
        raise LookupError(f"no plan session {session_id}")
    if distance_m is not None and not 0 < distance_m <= 500_000:
        raise ValueError("distance must be between 0 and 500 km")
    new_day = None if day is None else _check_day(day)
    if new_day == row[0]["day"]:
        new_day = None
    if distance_m is not None and row[0]["planned_min_m"] is not None and abs(
        distance_m - float(row[0]["planned_min_m"])
    ) < 1.0:
        distance_m = None
    if new_day is None and distance_m is None:
        return clear_edit(store, session_id)

    with store.tx():
        store.conn.execute(
            "INSERT INTO plan_edits (plan_session_id, day, planned_m, edited_at) "
            "VALUES (?, ?, ?, ?) ON CONFLICT (plan_session_id) DO UPDATE SET "
            "day = excluded.day, planned_m = excluded.planned_m, edited_at = excluded.edited_at",
            (session_id, new_day, distance_m, utcnow()),
        )
    return {"session_id": session_id, "state": "edited"}


def clear_edit(store, session_id: int) -> dict[str, Any]:
    with store.tx():
        store.conn.execute("DELETE FROM plan_edits WHERE plan_session_id = ?", (session_id,))
    return {"session_id": session_id, "state": "cleared"}


def add_session(
    store, day: str, sport: str, distance_m: float | None = None, title: str | None = None
) -> dict[str, Any]:
    """A session of the owner's own. It is a `plan_sessions` row with no source, so no
    sync can withdraw it, and it flows through the matcher like any other."""
    import uuid

    if sport not in OWN_SPORTS:
        raise ValueError(f"sport must be one of {', '.join(OWN_SPORTS)}")
    day = _check_day(day)
    if distance_m is not None and not 0 < distance_m <= 500_000:
        raise ValueError("distance must be between 0 and 500 km")
    label = (title or "").strip() or f"{sport.capitalize()} (added by you)"
    with store.tx():
        cur = store.conn.execute(
            "INSERT INTO plan_sessions (source_id, uid, recurrence_id, day, title, sport, kind, "
            "planned_min_m, planned_max_m, optional, recurring, parse_source, parse_status) "
            "VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 'edit', 'ok')",
            (f"own:{uuid.uuid4().hex[:12]}", day, day, label[:120], sport, OWN_KINDS[sport],
             distance_m, distance_m),
        )
        new_id = int(cur.lastrowid or 0)
    return {"session_id": new_id, "state": "added"}


def remove_session(store, session_id: int) -> dict[str, Any]:
    """Take away a session the owner added. A calendar session is not theirs to remove:
    the calendar owns it, and `Ignore` already says "this one does not count"."""
    from ..db.store import utcnow

    own = store.scalar(
        "SELECT id FROM plan_sessions WHERE id = ? AND uid LIKE 'own:%' AND withdrawn_at IS NULL",
        (session_id,),
    )
    if own is None:
        raise LookupError(f"no session of your own with id {session_id}")
    with store.tx():
        store.conn.execute(
            "UPDATE plan_sessions SET withdrawn_at = ? WHERE id = ?", (utcnow(), session_id)
        )
    return {"session_id": session_id, "state": "removed"}


#: How a race's title reads once the keyword that identified it is taken off.
_RACE_PREFIX = re.compile(r"^\s*RACE\s*[:\-–]\s*", re.IGNORECASE)


def session_for_activity(
    store, activity_id: str, today: date | None = None
) -> dict[str, Any]:
    """The plan session an activity fulfilled, and the next one of the same kind.

    Both are null when the activity was not part of the plan (a ride nobody prescribed),
    and `next` is also null when the plan has no further session of that kind. The kind
    is what makes "the next long run" mean something: it is the one the activity answered.
    """
    today = today or date.today()
    judged, _ = judge_all(store, today)
    mine = next((i for i in judged if i.activity_id == activity_id), None)
    if mine is None:
        return {"session": None, "next": None}
    upcoming = [
        i
        for i in judged
        if i.verdict == "upcoming"
        and not i.planned.optional
        and not i.planned.ignored
        and i.planned.kind == mine.planned.kind
        and i.planned.sport == mine.planned.sport
        and date.fromisoformat(i.planned.day) >= today
    ]
    following = min(upcoming, key=lambda i: i.planned.day, default=None)
    return {
        "session": _as_dict(mine),
        "next": None if following is None else _as_dict(following),
    }


def goal_race(store, today: date | None = None) -> dict[str, Any] | None:
    """The race the training is pointed at: the nearest one still to come.

    Read from the calendar rather than held as a constant. The parser already marks a
    session `kind='race'` from the word RACE in its title, and such a session carries
    the name, the day, the start time and the distance — every fact the four
    `config.RACE_*` constants held, kept current by a sync instead of a rebuild.

    Nearest upcoming rather than one the owner pins: it self-heals the day after a race
    is run, and a race nobody wants to aim at is simply not titled RACE. Race day
    itself still counts as upcoming — the panel should not go blank at breakfast.

    `None` when the calendar names no race ahead, which the views show as no goal line
    rather than inventing one (D12).
    """
    today = today or date.today()
    rows = store.query(
        "SELECT day, start_local, title, planned_min_m, planned_max_m "
        "FROM plan_sessions "
        "WHERE withdrawn_at IS NULL AND kind = 'race' AND day >= ? "
        "ORDER BY day, start_local",
        (today.isoformat(),),
    )
    if not rows:
        return None

    # Race day holds more than one race-kinded session: the club's own `Long Run -
    # DBRC` sits beside `RACE: Ooredoo Doha Half Marathon`, because both carry the
    # word. Within the earliest day, prefer the one that says RACE outright, then one
    # that names a distance — taking the first by time picked the 05:00 club run and
    # reported the half as an unnamed, distanceless session.
    first_day = str(rows[0]["day"])
    same_day = [r for r in rows if str(r["day"]) == first_day]
    row = min(
        same_day,
        key=lambda r: (
            _RACE_PREFIX.match(str(r["title"] or "")) is None,
            (r["planned_min_m"] or r["planned_max_m"]) is None,
            str(r["start_local"] or ""),
        ),
    )
    start = str(row["start_local"] or "")
    distance = row["planned_min_m"] or row["planned_max_m"]
    return {
        "name": _RACE_PREFIX.sub("", str(row["title"] or "")).strip() or "Race",
        "date": str(row["day"]),
        # `start_local` is an ISO datetime; the panel wants the wall clock off it.
        "start_local": start[11:16] if len(start) >= 16 else None,
        "timezone": config.RACE_TIMEZONE,
        "distance_m": None if distance is None else float(distance),
    }
