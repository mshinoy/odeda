"""Body composition: what the scale actually says, once the noise is taken out.

A daily weigh-in is mostly hydration. The spread between two consecutive mornings is
around 0.6 kg on the owner's own data, and a training block's real change is a few
kilograms over months — so a single reading carries almost no information about the
trend and reporting one as news is the central mistake this module exists to avoid.
Everything here works on a smoothed series; the raw readings are for drawing faintly
behind it, not for drawing conclusions from.

Six things are computed, and each is here because it answers a question the scale alone
cannot:

  `composition`  the trend, and fat mass against lean mass. Losing fat and losing
                 muscle are identical on a scale and opposite in every way that matters.
  `consistency`  how often the scale is actually used, because every number below
                 degrades with gaps and the owner should be able to see by how much.
  `projection`   the trend carried forward to race day. A projection, clearly labelled
                 as one, is more useful than a number with no horizon.
  `against_load` the weight trend beside CTL, so a build block's cost in bodyweight is
                 visible rather than inferred.
  `power_to_weight`  W/kg for rides. This one is real physiology, not a heuristic:
                 climbing speed is very nearly linear in it.
  `speed_vs_weight`  run speed and bodyweight, both indexed. Deliberately *not* a
                 conversion — see the note on that function.
"""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any, Iterable, Mapping, Sequence

from ..config import RACE_DATE, RACE_DISTANCE_M, RACE_NAME

# ---------------------------------------------------------------------------
# Smoothing
# ---------------------------------------------------------------------------

#: Days for the trend to move halfway to a sustained change. Seven is the shortest
#: window that clears the weekly cycle of eating and training; shorter and the "trend"
#: is just Monday morning after Sunday's long run.
HALF_LIFE_DAYS = 7.0

#: The most of the gap a single reading may close, however long the gap was.
#: Without this, coming back to the scale after a fortnight away replaces the trend
#: with one noisy morning — and the gap is exactly when the athlete is least likely to
#: have weighed themselves under the usual conditions.
MAX_STEP = 0.5


def smooth(
    days: Sequence[str], values: Sequence[float | None], half_life_days: float = HALF_LIFE_DAYS
) -> list[float | None]:
    """Gap-aware exponential trend over an irregular series of readings.

    On a daily series this is an ordinary EWMA. On a series with holes in it, the
    per-day decay is applied `gap` times over — a reading ten days after the last one
    carries more weight than one taken the next morning, because there is genuinely
    less recent information to weigh it against.

    Where this departs from the textbook is `MAX_STEP`. Continuous-time EWMA sends the
    weight on a new reading to 1 as the gap grows, so a reading after a month away
    *becomes* the trend. That is right about the staleness of the old estimate and
    wrong about the reliability of the new one: it is still a single number with
    ±0.6 kg of hydration in it. Capping the step at half means a long gap needs two
    readings to re-establish the trend, which is what an honest answer requires.

    Returns a list parallel to `days`, null before the first reading.
    """
    per_day_decay = 0.5 ** (1.0 / half_life_days)
    out: list[float | None] = []
    trend: float | None = None
    last_day: date | None = None

    for day_text, value in zip(days, values):
        if value is None:
            out.append(trend)
            continue
        today = date.fromisoformat(day_text)
        if trend is None:
            trend = float(value)
        else:
            gap = max((today - last_day).days, 1) if last_day else 1
            step = min(1.0 - per_day_decay**gap, MAX_STEP)
            trend += step * (float(value) - trend)
        last_day = today
        out.append(trend)
    return out


def slope_per_day(days: Sequence[str], values: Sequence[float | None]) -> float | None:
    """Least-squares slope in units per day. None when there is nothing to fit.

    Fitted on ordinal dates rather than on position in the list, so a gap counts as the
    time it actually was — the whole point of fitting a rate.
    """
    points = [
        (date.fromisoformat(d).toordinal(), float(v))
        for d, v in zip(days, values)
        if v is not None
    ]
    if len(points) < 2:
        return None
    n = len(points)
    mean_x = sum(x for x, _ in points) / n
    mean_y = sum(y for _, y in points) / n
    variance = sum((x - mean_x) ** 2 for x, _ in points)
    if variance < 1e-9:
        return None
    covariance = sum((x - mean_x) * (y - mean_y) for x, y in points)
    return covariance / variance


# ---------------------------------------------------------------------------
# Reading the table
# ---------------------------------------------------------------------------


def weigh_ins(store, start: str | None = None, end: str | None = None) -> list[dict[str, Any]]:
    """Every stored reading, oldest first, optionally bounded.

    A row with no weight is not a weigh-in: `body_composition` is keyed by day and a
    fat-only entry would otherwise count towards consistency and smooth as a null.
    """
    conditions = ["weight_kg IS NOT NULL"]
    params: list[Any] = []
    if start:
        conditions.append("day >= ?")
        params.append(start)
    if end:
        conditions.append("day <= ?")
        params.append(end)
    return store.query(
        "SELECT day, weight_kg, body_fat_pct, bmi FROM body_composition "
        f"WHERE {' AND '.join(conditions)} ORDER BY day",
        params,
    )


def dense_days(first: str, last: str) -> list[str]:
    """Every calendar day between two, inclusive. Gaps have to exist to be seen."""
    start, end = date.fromisoformat(first), date.fromisoformat(last)
    return [(start + timedelta(days=i)).isoformat() for i in range((end - start).days + 1)]


# ---------------------------------------------------------------------------
# Composition
# ---------------------------------------------------------------------------


def composition(rows: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
    """The headline series: raw readings, the trend, and the fat/lean split.

    Everything is on one dense daily axis so the chart can draw the trend as a
    continuous line and the readings as points with real gaps between them. A sparse
    axis would close the gaps and quietly claim the scale was used every day.
    """
    if not rows:
        return {"days": [], "weight_kg": [], "trend_kg": [], "fat_kg": [], "lean_kg": []}

    days = dense_days(str(rows[0]["day"]), str(rows[-1]["day"]))
    by_day = {str(r["day"]): r for r in rows}

    weight: list[float | None] = []
    fat: list[float | None] = []
    lean: list[float | None] = []
    for day in days:
        row = by_day.get(day)
        kg = None if row is None else _as_float(row.get("weight_kg"))
        weight.append(kg)
        pct = None if row is None else _as_float(row.get("body_fat_pct"))
        if kg is None or pct is None:
            fat.append(None)
            lean.append(None)
        else:
            fat_kg = kg * pct / 100.0
            fat.append(fat_kg)
            lean.append(kg - fat_kg)

    return {
        "days": days,
        "weight_kg": [_round(v, 2) for v in weight],
        "trend_kg": [_round(v, 2) for v in smooth(days, weight)],
        "fat_kg": [_round(v, 2) for v in smooth(days, fat)],
        "lean_kg": [_round(v, 2) for v in smooth(days, lean)],
    }


# ---------------------------------------------------------------------------
# Consistency
# ---------------------------------------------------------------------------


def consistency(rows: Sequence[Mapping[str, Any]], today: date | None = None) -> dict[str, Any]:
    """How often the scale is actually used.

    This is not housekeeping. Every other number here is a function of how much data
    there is, and the honest way to say "the trend is thin at the moment" is to show
    the gaps rather than to add a disclaimer to the trend.
    """
    if not rows:
        return {
            "readings": 0, "span_days": 0, "coverage_pct": 0.0, "per_week": 0.0,
            "longest_gap_days": None, "days_since_last": None,
        }

    days = [date.fromisoformat(str(r["day"])) for r in rows]
    span = (days[-1] - days[0]).days + 1
    gaps = [(later - earlier).days for earlier, later in zip(days, days[1:])]
    return {
        "readings": len(days),
        "span_days": span,
        "coverage_pct": round(100.0 * len(days) / span, 1),
        "per_week": round(7.0 * len(days) / span, 2),
        # A gap is the days *between* two readings: consecutive mornings are no gap.
        "longest_gap_days": max(gaps) - 1 if gaps else 0,
        "days_since_last": ((today or date.today()) - days[-1]).days,
    }


# ---------------------------------------------------------------------------
# Race-day projection
# ---------------------------------------------------------------------------

#: Days of trend the projection is fitted over. Eight weeks is long enough to average
#: out a bad fortnight and short enough that a block from six months ago, at a
#: different volume, is not being extrapolated.
PROJECTION_WINDOW_DAYS = 56

#: Below this there is no line worth fitting, and a projection from three readings
#: would be a straight face on a coin toss.
MIN_READINGS_FOR_PROJECTION = 8
MIN_SPAN_FOR_PROJECTION_DAYS = 28

#: **A rule of thumb, not physiology.** The commonly quoted figure for distance running
#: is about 2 seconds per mile per pound — 2 / 1.609 / 0.4536 ≈ 2.7 s per km per kg. It
#: is a rough empirical average across runners, it assumes the weight lost is fat rather
#: than muscle, and it says nothing about *this* athlete. It is included because a
#: number with a horizon is more useful than none, and it is labelled everywhere it is
#: shown because dressing a heuristic up as a prediction would be worse than silence.
SECONDS_PER_KM_PER_KG = 2.7


def race_projection(
    series: Mapping[str, Any],
    race_day: date = RACE_DATE,
    today: date | None = None,
    window_days: int = PROJECTION_WINDOW_DAYS,
) -> dict[str, Any] | None:
    """Carry the recent trend forward to race day. None when there is not enough to fit.

    Fitted on the smoothed trend, not on the raw readings: the readings' noise is
    symmetric and would not move the slope much, but it would make the fit's honesty
    depend on which mornings happened to fall at the ends of the window.
    """
    days: list[str] = list(series.get("days") or [])
    trend: list[float | None] = list(series.get("trend_kg") or [])
    weights: list[float | None] = list(series.get("weight_kg") or [])
    if not days:
        return None

    today = today or date.today()
    cutoff = (today - timedelta(days=window_days)).isoformat()
    window = [(d, t) for d, t in zip(days, trend) if d >= cutoff and t is not None]
    readings_used = sum(1 for d, w in zip(days, weights) if d >= cutoff and w is not None)

    if readings_used < MIN_READINGS_FOR_PROJECTION or len(window) < MIN_SPAN_FOR_PROJECTION_DAYS:
        return None

    slope = slope_per_day([d for d, _ in window], [t for _, t in window])
    if slope is None:
        return None

    current = window[-1][1]
    days_out = (race_day - today).days
    projected = current + slope * days_out
    delta = projected - current

    return {
        "race_name": RACE_NAME,
        "race_day": race_day.isoformat(),
        "days_out": days_out,
        "current_trend_kg": round(current, 2),
        "projected_kg": round(projected, 2),
        "change_kg": round(delta, 2),
        "slope_kg_per_week": round(slope * 7.0, 3),
        "window_days": window_days,
        "readings_used": readings_used,
        # Signed the way a runner reads it: losing weight is a negative `change_kg`
        # and a negative number of seconds, i.e. faster.
        "rule_of_thumb_s_per_km": round(delta * SECONDS_PER_KM_PER_KG, 1),
        "rule_of_thumb_race_s": round(delta * SECONDS_PER_KM_PER_KG * RACE_DISTANCE_M / 1000.0),
    }


# ---------------------------------------------------------------------------
# Against the training data
# ---------------------------------------------------------------------------


def against_load(
    series: Mapping[str, Any], curve: Sequence[Mapping[str, Any]]
) -> list[dict[str, Any]]:
    """The weight trend on the same axis of days as CTL.

    The question this answers is the one a build block always raises: whether the
    weight came off because of the training or in spite of it, and whether it kept
    coming off when the volume did. Only days that have both are returned, so the chart
    never draws a line across a period one of them does not cover.
    """
    trend_by_day = {
        day: value
        for day, value in zip(series.get("days") or [], series.get("trend_kg") or [])
        if value is not None
    }
    out: list[dict[str, Any]] = []
    for point in curve:
        day = str(point.get("day"))
        if day in trend_by_day:
            out.append(
                {
                    "day": day,
                    "trend_kg": round(float(trend_by_day[day]), 2),
                    "ctl": round(float(point.get("ctl") or 0.0), 2),
                }
            )
    return out


#: Rides shorter than this are warm-ups and commutes; their average power says more
#: about traffic lights than about the athlete.
MIN_RIDE_S = 20 * 60


def power_to_weight(
    rides: Iterable[Mapping[str, Any]], series: Mapping[str, Any]
) -> list[dict[str, Any]]:
    """W/kg per ride, against the weight trend on the day of the ride.

    The one genuinely physiological normalisation available here: on a climb, speed is
    very nearly linear in watts per kilogram, so this is a real performance number
    rather than a conversion with a caveat attached.

    Against the *trend* on the day, not that morning's reading: dividing by a number
    with 0.6 kg of hydration noise in it would put that noise straight into the
    performance series, where it would be indistinguishable from form.
    """
    trend_by_day = {
        day: value
        for day, value in zip(series.get("days") or [], series.get("trend_kg") or [])
        if value is not None
    }
    out: list[dict[str, Any]] = []
    for ride in rides:
        day = str(ride.get("day"))
        watts = _as_float(ride.get("avg_power_w"))
        duration = _as_float(ride.get("duration_s")) or 0.0
        kg = trend_by_day.get(day)
        if watts is None or kg is None or kg <= 0 or duration < MIN_RIDE_S:
            continue
        out.append(
            {
                "day": day,
                "activity_id": str(ride.get("activity_id") or ""),
                "watts_per_kg": round(watts / kg, 2),
            }
        )
    return out


def speed_vs_weight(
    runs: Iterable[Mapping[str, Any]], series: Mapping[str, Any]
) -> list[dict[str, Any]]:
    """Run speed and bodyweight, each as a percentage of where it started.

    Deliberately **not** "pace per kilogram". For running, the metabolic cost is already
    roughly proportional to bodyweight, so speed is a mass-normalised quantity to begin
    with and dividing it by mass again produces a number with no meaning. Every honest
    version of "how much of this improvement is the weight?" is a rule of thumb, and
    there is already exactly one of those in this module, on the projection, labelled.

    What this shows instead is both series side by side on one scale: if speed is up
    4 % while weight is down 2 %, the improvement is not explained by the scale. That
    is a comparison the reader makes, not a conversion the code invents.

    Weekly means, because one run's average speed is mostly its route and the weather.
    """
    trend_by_day = {
        day: value
        for day, value in zip(series.get("days") or [], series.get("trend_kg") or [])
        if value is not None
    }

    weekly: dict[str, list[float]] = {}
    for run in runs:
        speed = _as_float(run.get("avg_speed_mps"))
        day = str(run.get("day"))
        if speed is None or speed <= 0 or day not in trend_by_day:
            continue
        weekly.setdefault(_week_start(day), []).append(speed)
    if not weekly:
        return []

    weeks = sorted(weekly)
    speeds = {w: sum(v) / len(v) for w, v in weekly.items()}
    kilos = {}
    for week in weeks:
        in_week = [
            trend_by_day[d] for d in _week_days(week) if d in trend_by_day
        ]
        if in_week:
            kilos[week] = sum(in_week) / len(in_week)

    weeks = [w for w in weeks if w in kilos]
    if len(weeks) < 2:
        return []
    base_speed, base_kg = speeds[weeks[0]], kilos[weeks[0]]
    if base_speed <= 0 or base_kg <= 0:
        return []

    return [
        {
            "week": week,
            "speed_index": round(100.0 * speeds[week] / base_speed, 1),
            "weight_index": round(100.0 * kilos[week] / base_kg, 1),
        }
        for week in weeks
    ]


def _week_start(day: str) -> str:
    d = date.fromisoformat(day)
    return (d - timedelta(days=d.weekday())).isoformat()


def _week_days(week_start: str) -> list[str]:
    start = date.fromisoformat(week_start)
    return [(start + timedelta(days=i)).isoformat() for i in range(7)]


# ---------------------------------------------------------------------------
# The whole report
# ---------------------------------------------------------------------------


def compute_body(store, days: int | None = 540, today: date | None = None) -> dict[str, Any]:
    """Everything `/api/body` returns. Empty and honest when nothing has been weighed.

    `days` bounds the *charts*, not the projection's input: the projection uses its own
    eight-week window, and consistency describes whatever is in range. An empty result
    carries `has_data: false` rather than a series of nulls, so the UI can hide the
    section instead of drawing an empty chart.
    """
    from . import load as load_mod

    today = today or date.today()
    start = (today - timedelta(days=days)).isoformat() if days else None
    rows = weigh_ins(store, start=start)

    if not rows:
        return {
            "has_data": False,
            "series": {"days": [], "weight_kg": [], "trend_kg": [], "fat_kg": [], "lean_kg": []},
            "consistency": consistency([], today),
            "latest": None,
            "projection": None,
            "against_load": [],
            "power_to_weight": [],
            "speed_vs_weight": [],
        }

    series = composition(rows)
    trend = [v for v in series["trend_kg"] if v is not None]
    fat = [v for v in series["fat_kg"] if v is not None]
    lean = [v for v in series["lean_kg"] if v is not None]

    activities = store.query(
        "SELECT activity_id, day, activity_type, avg_speed_mps, avg_power_w, duration_s "
        "FROM v_activities_included WHERE day >= ? ORDER BY day",
        [series["days"][0]],
    )
    curve = load_mod.compute_load(store).get("curve") or []

    return {
        "has_data": True,
        "series": series,
        "consistency": consistency(rows, today),
        "latest": {
            "day": series["days"][-1],
            "trend_kg": trend[-1] if trend else None,
            "reading_kg": _last(series["weight_kg"]),
            "fat_kg": fat[-1] if fat else None,
            "lean_kg": lean[-1] if lean else None,
            # Over the window drawn, which is what the card sits next to.
            "change_kg": round(trend[-1] - trend[0], 2) if len(trend) > 1 else None,
            "fat_change_kg": round(fat[-1] - fat[0], 2) if len(fat) > 1 else None,
            "lean_change_kg": round(lean[-1] - lean[0], 2) if len(lean) > 1 else None,
        },
        "projection": race_projection(series, today=today),
        "against_load": against_load(series, curve),
        "power_to_weight": power_to_weight(
            [a for a in activities if str(a["activity_type"]).endswith("cycling")], series
        ),
        "speed_vs_weight": speed_vs_weight(
            [a for a in activities if str(a["activity_type"]).endswith("running")], series
        ),
    }


# ---------------------------------------------------------------------------


def _as_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _round(value: float | None, digits: int) -> float | None:
    return None if value is None else round(value, digits)


def _last(values: Sequence[float | None]) -> float | None:
    for value in reversed(values):
        if value is not None:
            return value
    return None
