"""Lifetime and per-period aggregates, distributions, patterns and records.

This answers the question the user actually asked: *"if I've run 300 times over the
past five years, what's my average pace, average speed"* — and then keeps going,
because the interesting part of a long history is not the total, it is the shape:
which days of the week you actually train, which months you disappear in, whether
this year is faster than last year, and where your records really sit.

Everything here reads `v_activities_included`, so:
  * user edits are respected (a run retyped from "walking" counts as a run);
  * an activity flagged exclude-from-stats is invisible to every number below.

Every function takes the same filter set (activity type, date range, gear), so the
whole tab can be driven by one filter bar.
"""

from __future__ import annotations

import math
import statistics
from datetime import date, datetime, timedelta
from typing import Any, Sequence

from ..db.store import Store
from . import performance as perf

#: Distances the records wall reports, in metres.
RECORD_DISTANCES = (1000.0, 5000.0, 10000.0, 15000.0, 21097.5, 42195.0)

#: Pace histogram buckets, seconds per kilometre.
PACE_BUCKET_S = 15.0
PACE_MIN_S, PACE_MAX_S = 150.0, 900.0     # 2:30/km to 15:00/km

DAY_NAMES = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")
MONTH_NAMES = ("Jan", "Feb", "Mar", "Apr", "May", "Jun",
               "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")


# ---------------------------------------------------------------------------
# Filtering
# ---------------------------------------------------------------------------


def _filters(
    activity_type: str | None = None,
    start: str | None = None,
    end: str | None = None,
    gear_id: int | None = None,
) -> tuple[str, list[Any]]:
    """Build the shared WHERE clause. `v` is the alias for v_activities_included."""
    where: list[str] = ["1 = 1"]
    params: list[Any] = []
    if activity_type:
        where.append("v.activity_type = ?")
        params.append(activity_type)
    if start:
        where.append("v.day >= ?")
        params.append(start)
    if end:
        where.append("v.day <= ?")
        params.append(end)
    if gear_id:
        where.append(
            "EXISTS (SELECT 1 FROM activity_gear ag "
            "WHERE ag.activity_id = v.activity_id AND ag.gear_id = ?)"
        )
        params.append(int(gear_id))
    return " AND ".join(where), params


# ---------------------------------------------------------------------------
# Totals
# ---------------------------------------------------------------------------


_TOTALS_SELECT = """
    COUNT(*)                                   AS activities,
    COALESCE(SUM(v.distance_m), 0)             AS distance_m,
    COALESCE(SUM(v.duration_s), 0)             AS duration_s,
    COALESCE(SUM(v.moving_time_s), 0)          AS moving_time_s,
    COALESCE(SUM(v.elevation_gain_m), 0)       AS elevation_gain_m,
    COALESCE(SUM(v.calories), 0)               AS calories,
    COALESCE(SUM(v.trimp), 0)                  AS trimp,
    AVG(v.avg_hr)                              AS avg_hr,
    AVG(v.distance_m)                          AS avg_distance_m,
    AVG(v.moving_time_s)                       AS avg_moving_time_s,
    MIN(v.day)                                 AS first_day,
    MAX(v.day)                                 AS last_day
"""


def _decorate(row: dict[str, Any]) -> dict[str, Any]:
    """Add the derived figures every caller wants: km, hours, average pace and speed.

    Average pace is computed from **total distance over total time**, not as the mean
    of per-activity paces. Those differ, and the distance-weighted one is the honest
    answer to "what's my average pace" — otherwise a 400 m stride counts as much as a
    30 km long run.
    """
    dist = float(row.get("distance_m") or 0.0)
    moving = float(row.get("moving_time_s") or 0.0)
    out = dict(row)
    out["distance_km"] = round(dist / 1000.0, 2)
    out["duration_h"] = round(float(row.get("duration_s") or 0.0) / 3600.0, 2)
    out["moving_time_h"] = round(moving / 3600.0, 2)
    out["avg_distance_km"] = (
        round(float(row["avg_distance_m"]) / 1000.0, 2) if row.get("avg_distance_m") else None
    )
    if dist > 0 and moving > 0:
        speed = dist / moving
        pace = 1000.0 / speed
        out["avg_speed_mps"] = round(speed, 3)
        out["avg_speed_kmh"] = round(speed * 3.6, 2)
        out["avg_pace_s_per_km"] = round(pace, 1)
        out["avg_pace"] = perf.pace_str(pace)
    else:
        out["avg_speed_mps"] = out["avg_speed_kmh"] = None
        out["avg_pace_s_per_km"] = out["avg_pace"] = None
    if row.get("avg_hr"):
        out["avg_hr"] = round(float(row["avg_hr"]), 1)
    for key in ("distance_m", "duration_s", "moving_time_s", "elevation_gain_m",
                "calories", "trimp"):
        if out.get(key) is not None:
            out[key] = round(float(out[key]), 1)
    return out


def totals(store: Store, **f: Any) -> dict[str, Any]:
    """Headline lifetime (or filtered) totals."""
    clause, params = _filters(**f)
    row = store.query(
        f"SELECT {_TOTALS_SELECT} FROM v_activities_included v WHERE {clause}", params
    )[0]
    out = _decorate(row)
    if out["first_day"] and out["last_day"]:
        d0 = date.fromisoformat(out["first_day"])
        d1 = date.fromisoformat(out["last_day"])
        years = max((d1 - d0).days / 365.25, 1 / 365.25)
        out["span_days"] = (d1 - d0).days + 1
        out["span_years"] = round(years, 2)
        out["activities_per_week"] = round(out["activities"] / (years * 52.18), 2)
        out["distance_km_per_week"] = round(out["distance_km"] / (years * 52.18), 2)
    return out


def by_type(store: Store, **f: Any) -> list[dict[str, Any]]:
    """One row per activity type — the "you have run 312 times" table."""
    f.pop("activity_type", None)
    clause, params = _filters(**f)
    rows = store.query(
        f"SELECT v.activity_type, {_TOTALS_SELECT} FROM v_activities_included v "
        f"WHERE {clause} GROUP BY v.activity_type ORDER BY activities DESC",
        params,
    )
    return [_decorate(r) for r in rows]


def by_period(store: Store, period: str = "year", **f: Any) -> list[dict[str, Any]]:
    """Totals grouped by year, month or ISO week."""
    expr = {
        "year": "substr(v.day, 1, 4)",
        "month": "substr(v.day, 1, 7)",
        "week": "strftime('%Y-W%W', v.day)",
    }.get(period)
    if expr is None:
        raise ValueError("period must be one of: year, month, week")
    clause, params = _filters(**f)
    rows = store.query(
        f"SELECT {expr} AS period, {_TOTALS_SELECT} FROM v_activities_included v "
        f"WHERE {clause} GROUP BY period ORDER BY period",
        params,
    )
    return [_decorate(r) for r in rows]


def year_over_year(store: Store, **f: Any) -> dict[str, Any]:
    """Every headline metric per year, with the change on the year before."""
    years = by_period(store, "year", **f)
    metrics = ("activities", "distance_km", "moving_time_h", "elevation_gain_m",
               "avg_pace_s_per_km", "avg_hr", "avg_distance_km")
    for i, row in enumerate(years):
        row["changes"] = {}
        if i == 0:
            continue
        prev = years[i - 1]
        for m in metrics:
            a, b = prev.get(m), row.get(m)
            if a in (None, 0) or b is None:
                row["changes"][m] = None
                continue
            row["changes"][m] = {
                "delta": round(b - a, 2),
                "pct": round(100.0 * (b - a) / abs(a), 1),
                # For pace, lower is better; the UI needs to know which way is up.
                "better": (b < a) if m == "avg_pace_s_per_km" else (b > a),
            }
    return {"metric_names": list(metrics), "years": years}


# ---------------------------------------------------------------------------
# Distributions
# ---------------------------------------------------------------------------


def distributions(store: Store, buckets: int = 18, **f: Any) -> dict[str, Any]:
    """Pace, distance, duration and HR-zone distributions for the filtered set."""
    clause, params = _filters(**f)
    rows = store.query(
        "SELECT v.activity_id, v.distance_m, v.moving_time_s, v.avg_speed_mps, v.avg_hr "
        f"FROM v_activities_included v WHERE {clause}",
        params,
    )

    paces = [
        1000.0 / float(r["avg_speed_mps"])
        for r in rows
        if r.get("avg_speed_mps") and float(r["avg_speed_mps"]) > 0
    ]
    paces = [p for p in paces if PACE_MIN_S <= p <= PACE_MAX_S]
    distances = [float(r["distance_m"]) / 1000.0 for r in rows if r.get("distance_m")]
    durations = [float(r["moving_time_s"]) / 60.0 for r in rows if r.get("moving_time_s")]
    hrs = [float(r["avg_hr"]) for r in rows if r.get("avg_hr")]

    zone_clause, zone_params = _filters(**f)
    zones = store.query(
        "SELECT z.zone, SUM(z.seconds) AS seconds FROM activity_hr_zones z "
        "JOIN v_activities_included v ON v.activity_id = z.activity_id "
        f"WHERE {zone_clause} GROUP BY z.zone ORDER BY z.zone",
        zone_params,
    )
    zone_total = sum(float(z["seconds"] or 0) for z in zones) or 1.0

    return {
        "pace": _fixed_histogram(paces, PACE_MIN_S, PACE_MAX_S, PACE_BUCKET_S,
                                 label=lambda lo: perf.pace_str(lo)),
        "distance_km": _auto_histogram(distances, buckets, digits=1),
        "duration_min": _auto_histogram(durations, buckets, digits=0),
        "avg_hr": _auto_histogram(hrs, buckets, digits=0),
        "hr_zones": [
            {
                "zone": int(z["zone"]),
                "seconds": round(float(z["seconds"] or 0), 1),
                "hours": round(float(z["seconds"] or 0) / 3600.0, 2),
                "pct": round(100.0 * float(z["seconds"] or 0) / zone_total, 1),
            }
            for z in zones
        ],
        "sample_size": len(rows),
    }


def _fixed_histogram(values, lo, hi, width, label=None) -> list[dict[str, Any]]:
    """Histogram over a fixed, meaningful range — used where buckets have units."""
    if not values:
        return []
    n = int(math.ceil((hi - lo) / width))
    counts = [0] * n
    for v in values:
        idx = int((v - lo) / width)
        if 0 <= idx < n:
            counts[idx] += 1
    out = []
    for i, c in enumerate(counts):
        if c == 0:
            continue
        bucket_lo = lo + i * width
        out.append(
            {
                "lo": round(bucket_lo, 2),
                "hi": round(bucket_lo + width, 2),
                "count": c,
                "label": label(bucket_lo) if label else f"{bucket_lo:.0f}",
            }
        )
    return out


def _auto_histogram(values, buckets: int, digits: int = 1) -> list[dict[str, Any]]:
    """Histogram over the observed range, for quantities with no natural bucket size."""
    vals = [v for v in values if v is not None]
    if not vals:
        return []
    lo, hi = min(vals), max(vals)
    if hi <= lo:
        return [{"lo": round(lo, digits), "hi": round(hi, digits),
                 "count": len(vals), "label": f"{lo:.{digits}f}"}]
    width = (hi - lo) / buckets
    counts = [0] * buckets
    for v in vals:
        idx = min(buckets - 1, int((v - lo) / width))
        counts[idx] += 1
    return [
        {
            "lo": round(lo + i * width, digits),
            "hi": round(lo + (i + 1) * width, digits),
            "count": c,
            "label": f"{lo + i * width:.{digits}f}",
        }
        for i, c in enumerate(counts)
    ]


# ---------------------------------------------------------------------------
# Patterns
# ---------------------------------------------------------------------------


def patterns(store: Store, **f: Any) -> dict[str, Any]:
    """When training actually happens: weekday, hour, month, and the two combined."""
    clause, params = _filters(**f)
    rows = store.query(
        "SELECT v.day, v.start_time_local, v.distance_m, v.moving_time_s "
        f"FROM v_activities_included v WHERE {clause}",
        params,
    )

    dow = [{"day": i, "name": DAY_NAMES[i], "count": 0, "distance_km": 0.0, "hours": 0.0}
           for i in range(7)]
    hours = [{"hour": h, "count": 0, "distance_km": 0.0} for h in range(24)]
    months = [{"month": m + 1, "name": MONTH_NAMES[m], "count": 0, "distance_km": 0.0}
              for m in range(12)]
    matrix = [[0] * 24 for _ in range(7)]

    for r in rows:
        try:
            d = date.fromisoformat(str(r["day"])[:10])
        except (TypeError, ValueError):
            continue
        km = float(r.get("distance_m") or 0.0) / 1000.0
        hrs = float(r.get("moving_time_s") or 0.0) / 3600.0

        wd = d.weekday()
        dow[wd]["count"] += 1
        dow[wd]["distance_km"] += km
        dow[wd]["hours"] += hrs

        months[d.month - 1]["count"] += 1
        months[d.month - 1]["distance_km"] += km

        hour = _hour_of(r.get("start_time_local"))
        if hour is not None:
            hours[hour]["count"] += 1
            hours[hour]["distance_km"] += km
            matrix[wd][hour] += 1

    for bucket in (*dow, *hours, *months):
        if "distance_km" in bucket:
            bucket["distance_km"] = round(bucket["distance_km"], 1)
        if "hours" in bucket:
            bucket["hours"] = round(bucket["hours"], 1)

    busiest = max(dow, key=lambda d: d["count"]) if rows else None
    peak_hour = max(hours, key=lambda h: h["count"]) if rows else None
    return {
        "day_of_week": dow,
        "hour_of_day": hours,
        "month_of_year": months,
        "dow_hour_matrix": matrix,
        "busiest_day": busiest["name"] if busiest and busiest["count"] else None,
        "peak_hour": peak_hour["hour"] if peak_hour and peak_hour["count"] else None,
        "total": len(rows),
    }


def _hour_of(value: Any) -> int | None:
    if not value:
        return None
    text = str(value).replace("T", " ")
    try:
        return datetime.strptime(text[:16], "%Y-%m-%d %H:%M").hour
    except ValueError:
        return None


def streaks(store: Store, **f: Any) -> dict[str, Any]:
    """Consistency: current and longest run of active days, and the biggest week."""
    clause, params = _filters(**f)
    rows = store.query(
        f"SELECT DISTINCT v.day FROM v_activities_included v WHERE {clause} ORDER BY v.day",
        params,
    )
    days = []
    for r in rows:
        try:
            days.append(date.fromisoformat(str(r["day"])[:10]))
        except (TypeError, ValueError):
            continue
    if not days:
        return {"current": 0, "longest": 0, "longest_end": None, "active_days": 0,
                "biggest_week": None, "rest_days": 0}

    longest = current = 1
    longest_end = days[0]
    for i in range(1, len(days)):
        if (days[i] - days[i - 1]).days == 1:
            current += 1
            if current > longest:
                longest, longest_end = current, days[i]
        else:
            current = 1

    # "Current" only counts if the streak reaches today or yesterday; a streak that
    # ended in 2024 is not a current streak.
    today = date.today()
    current_streak = current if (today - days[-1]).days <= 1 else 0

    weeks = store.query(
        "SELECT strftime('%Y-W%W', v.day) AS week, COUNT(*) AS n, "
        "COALESCE(SUM(v.distance_m), 0) AS distance_m, "
        "COALESCE(SUM(v.moving_time_s), 0) AS moving_time_s "
        f"FROM v_activities_included v WHERE {clause} "
        "GROUP BY week ORDER BY distance_m DESC LIMIT 1",
        params,
    )
    span = (days[-1] - days[0]).days + 1
    return {
        "current": current_streak,
        "longest": longest,
        "longest_end": longest_end.isoformat(),
        "active_days": len(days),
        "span_days": span,
        "rest_days": span - len(days),
        "active_pct": round(100.0 * len(days) / span, 1) if span else None,
        "biggest_week": (
            {
                "week": weeks[0]["week"],
                "activities": int(weeks[0]["n"]),
                "distance_km": round(float(weeks[0]["distance_m"]) / 1000.0, 1),
                "hours": round(float(weeks[0]["moving_time_s"]) / 3600.0, 1),
            }
            if weeks
            else None
        ),
    }


# ---------------------------------------------------------------------------
# Records
# ---------------------------------------------------------------------------


def records(store: Store, **f: Any) -> dict[str, Any]:
    """The records wall: best efforts at each distance, plus the extremes."""
    clause, params = _filters(**f)

    # Best efforts are labelled "5 k" and priced in min/km, so with no explicit sport
    # filter they have to be restricted to the foot-borne sports; otherwise the wall
    # is just a list of bike rides. An explicit activity_type filter is the user
    # asking for that sport's records and is honoured as given.
    effort_clause, effort_params = clause, list(params)
    if not f.get("activity_type"):
        effort_clause += (
            " AND v.activity_type IN ("
            + ", ".join("?" for _ in perf.BEST_EFFORT_TYPES)
            + ")"
        )
        effort_params += list(perf.BEST_EFFORT_TYPES)

    best_efforts = []
    for dist in RECORD_DISTANCES:
        row = store.query(
            "SELECT b.distance_m, b.seconds, b.day, b.activity_id, v.activity_name "
            "FROM best_efforts b "
            "JOIN v_activities_included v ON v.activity_id = b.activity_id "
            f"WHERE {effort_clause} AND b.distance_m = ? "
            "ORDER BY b.seconds LIMIT 1",
            [*effort_params, dist],
        )
        if not row:
            continue
        r = row[0]
        secs = float(r["seconds"])
        best_efforts.append(
            {
                "distance_m": dist,
                "label": perf.DISTANCE_LABELS.get(dist, f"{dist / 1000:.1f} km"),
                "seconds": round(secs, 1),
                "time": perf.hms(secs),
                "pace": perf.pace_str(secs / (dist / 1000.0)),
                "day": r["day"],
                "activity_id": r["activity_id"],
                "activity_name": r["activity_name"],
            }
        )

    extremes = []
    for key, label, expr, order, fmt in (
        ("longest_distance", "Longest distance", "v.distance_m", "DESC", "km"),
        ("longest_duration", "Longest duration", "v.moving_time_s", "DESC", "time"),
        ("most_elevation", "Most elevation", "v.elevation_gain_m", "DESC", "m"),
        ("fastest_average", "Fastest average pace", "v.avg_speed_mps", "DESC", "pace"),
        ("highest_hr", "Highest max HR", "v.max_hr", "DESC", "bpm"),
        ("biggest_trimp", "Hardest session (TRIMP)", "v.trimp", "DESC", "raw"),
    ):
        row = store.query(
            f"SELECT v.activity_id, v.day, v.activity_name, v.activity_type, {expr} AS value "
            f"FROM v_activities_included v WHERE {clause} AND {expr} IS NOT NULL "
            f"ORDER BY value {order} LIMIT 1",
            params,
        )
        if not row:
            continue
        r = row[0]
        value = float(r["value"])
        extremes.append(
            {
                "key": key,
                "label": label,
                "raw": round(value, 3),
                "display": _format_extreme(value, fmt),
                "day": r["day"],
                "activity_id": r["activity_id"],
                "activity_name": r["activity_name"],
                "activity_type": r["activity_type"],
            }
        )

    return {"best_efforts": best_efforts, "extremes": extremes}


def _format_extreme(value: float, fmt: str) -> str:
    if fmt == "km":
        return f"{value / 1000.0:.2f} km"
    if fmt == "time":
        return perf.hms(value)
    if fmt == "m":
        return f"{value:.0f} m"
    if fmt == "pace":
        # pace_str already carries the "/km" suffix.
        return perf.pace_str(1000.0 / value) if value > 0 else "—"
    if fmt == "bpm":
        return f"{value:.0f} bpm"
    return f"{value:.1f}"


# ---------------------------------------------------------------------------
# One call for the whole tab
# ---------------------------------------------------------------------------


def compute_aggregate(store: Store, **f: Any) -> dict[str, Any]:
    """Everything the Aggregates tab needs, in one round trip."""
    return {
        "filters": {k: v for k, v in f.items() if v not in (None, "")},
        "totals": totals(store, **f),
        "by_type": by_type(store, **{k: v for k, v in f.items() if k != "activity_type"}),
        "by_year": by_period(store, "year", **f),
        "by_month": by_period(store, "month", **f),
        "year_over_year": year_over_year(store, **f),
        "distributions": distributions(store, **f),
        "patterns": patterns(store, **f),
        "streaks": streaks(store, **f),
        "records": records(store, **f),
    }


def available_filters(store: Store) -> dict[str, Any]:
    """What the filter bar can offer: known types, gear and the full date range."""
    types = store.query(
        "SELECT v.activity_type AS value, COUNT(*) AS n FROM v_activities_included v "
        "GROUP BY 1 ORDER BY n DESC"
    )
    gear = store.query(
        "SELECT g.gear_id, g.kind, g.brand, g.model, g.nickname, COUNT(ag.activity_id) AS n "
        "FROM gear g LEFT JOIN activity_gear ag ON ag.gear_id = g.gear_id "
        "GROUP BY g.gear_id ORDER BY n DESC"
    )
    span = store.query(
        "SELECT MIN(day) AS first_day, MAX(day) AS last_day FROM v_activities_included"
    )[0]
    return {"types": types, "gear": gear, "range": span}
