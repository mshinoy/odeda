"""Weekly / monthly rollups, streaks and consistency.

Everything here reads `v_activities_included` rather than `activities`, so user
edits are respected (a walk retyped as a run counts as a run) and an activity
flagged exclude-from-stats is invisible to every total, streak and rollup below.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta
from typing import Iterable, Mapping, Sequence

WEEKDAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


def iso_week_key(day: str) -> str:
    """`2026-W38`. ISO weeks, not SQLite's `%Y-%W`, which disagrees at year boundaries."""
    iso = date.fromisoformat(day).isocalendar()
    return f"{iso.year}-W{iso.week:02d}"


def week_start(day: str) -> str:
    d = date.fromisoformat(day)
    return (d - timedelta(days=d.isocalendar().weekday - 1)).isoformat()


def longest_streak(days: Iterable[str]) -> dict[str, object]:
    """Longest run of consecutive calendar days present in `days`."""
    ordered = sorted({d for d in days})
    if not ordered:
        return {"length": 0, "start": None, "end": None}
    best = cur = 1
    best_start = cur_start = ordered[0]
    best_end = ordered[0]
    for prev, nxt in zip(ordered, ordered[1:]):
        if date.fromisoformat(nxt) - date.fromisoformat(prev) == timedelta(days=1):
            cur += 1
        else:
            cur = 1
            cur_start = nxt
        if cur > best:
            best, best_start, best_end = cur, cur_start, nxt
    return {"length": best, "start": best_start, "end": best_end}


def current_streak(days: Iterable[str], today: date | None = None) -> int:
    """Consecutive active days ending today (or yesterday — today may not be over)."""
    have = {d for d in days}
    today = today or date.today()
    cursor = today if today.isoformat() in have else today - timedelta(days=1)
    n = 0
    while cursor.isoformat() in have:
        n += 1
        cursor -= timedelta(days=1)
    return n


def weekday_consistency(days: Iterable[str]) -> list[dict[str, object]]:
    counts = defaultdict(int)
    for d in days:
        counts[date.fromisoformat(d).weekday()] += 1
    total = sum(counts.values()) or 1
    return [
        {"weekday": WEEKDAY_NAMES[i], "count": counts.get(i, 0), "pct": round(counts.get(i, 0) / total * 100, 1)}
        for i in range(7)
    ]


def pct_delta(now: float | None, prev: float | None) -> float | None:
    if now is None or prev in (None, 0):
        return None
    return round((float(now) - float(prev)) / float(prev) * 100.0, 1)


# ---------------------------------------------------------------------------
# Store-backed
# ---------------------------------------------------------------------------


def _group_by_week(rows: Sequence[dict], day_key: str = "day") -> dict[str, list[dict]]:
    buckets: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        buckets[iso_week_key(str(r[day_key]))].append(r)
    return buckets


def _avg(rows: Sequence[dict], key: str) -> float | None:
    vals = [float(r[key]) for r in rows if r.get(key) is not None]
    return sum(vals) / len(vals) if vals else None


def _sum(rows: Sequence[dict], key: str) -> float:
    return sum(float(r[key]) for r in rows if r.get(key) is not None)


def weekly_report(store, limit: int = 26) -> list[dict[str, object]]:
    acts = store.query("SELECT * FROM v_activities_included ORDER BY day")
    daily = store.query("SELECT * FROM v_daily ORDER BY day")
    act_weeks = _group_by_week(acts)
    day_weeks = _group_by_week(daily)

    rows = []
    for wk in sorted(act_weeks):
        a = act_weeks[wk]
        runs = [r for r in a if r["activity_type"] == "running"]
        rows.append(
            {
                "week": wk,
                "start": week_start(str(min(r["day"] for r in a))),
                "sessions": len(a),
                "runs": len(runs),
                # `km` is all-sport (a bike ride is 20 km of nothing much); `run_km` is
                # the number a runner actually cares about. Both, clearly labelled.
                "km": _sum(a, "distance_m") / 1000.0,
                "run_km": _sum(runs, "distance_m") / 1000.0,
                "hours": _sum(a, "moving_time_s") / 3600.0,
                "trimp": _sum(a, "trimp"),
                "elev_m": _sum(a, "elevation_gain_m"),
                "avg_hr": _avg(a, "avg_hr"),
            }
        )

    wellness = {}
    for wk, d in day_weeks.items():
        wellness[wk] = {
            "rhr": _avg(d, "resting_hr"),
            "hrv": _avg(d, "hrv"),
            "sleep_score": _avg(d, "sleep_score"),
            "sleep_h": (lambda v: v / 3600.0 if v is not None else None)(_avg(d, "total_sleep_s")),
            "steps": _sum(d, "steps"),
        }

    out = []
    for i, r in enumerate(rows):
        w = wellness.get(r["week"], {})
        prev = rows[i - 1] if i else {}
        out.append(
            {
                "week": r["week"],
                "start": r["start"],
                "sessions": r["sessions"],
                "runs": r["runs"],
                "km": round(float(r["km"] or 0), 1),
                "run_km": round(float(r["run_km"] or 0), 1),
                "hours": round(float(r["hours"] or 0), 2),
                "trimp": round(float(r["trimp"] or 0), 1),
                "elev_m": round(float(r["elev_m"] or 0)),
                "avg_hr": round(float(r["avg_hr"]), 1) if r["avg_hr"] else None,
                "rhr": round(float(w["rhr"]), 1) if w.get("rhr") else None,
                "hrv": round(float(w["hrv"]), 1) if w.get("hrv") else None,
                "sleep_h": round(float(w["sleep_h"]), 2) if w.get("sleep_h") else None,
                "sleep_score": round(float(w["sleep_score"]), 1) if w.get("sleep_score") else None,
                "steps": int(w["steps"]) if w.get("steps") else None,
                "km_delta_pct": pct_delta(r["run_km"], prev.get("run_km")),
                "trimp_delta_pct": pct_delta(r["trimp"], prev.get("trimp")),
            }
        )
    return out[-limit:]


def monthly_report(store, limit: int = 24) -> list[dict[str, object]]:
    rows = store.query(
        """
        SELECT substr(a.day, 1, 7)           AS month,
               COUNT(*)                      AS sessions,
               SUM(a.distance_m) / 1000.0    AS km,
               SUM(CASE WHEN a.activity_type = 'running' THEN a.distance_m ELSE 0 END) / 1000.0 AS run_km,
               SUM(COALESCE(a.moving_time_s, a.duration_s)) / 3600.0 AS hours,
               SUM(a.trimp)                  AS trimp,
               SUM(a.elevation_gain_m)       AS elev_m
        FROM v_activities_included a
        GROUP BY month ORDER BY month
        """
    )
    wellness = {
        r["month"]: r
        for r in store.query(
            """
            SELECT substr(d.day, 1, 7) AS month,
                   AVG(d.resting_hr) AS rhr,
                   AVG(h.last_night_avg) AS hrv,
                   AVG(s.sleep_score) AS sleep_score,
                   AVG(b.weight_kg) AS weight_kg,
                   AVG(f.vo2max_run) AS vo2max
            FROM daily_wellness d
            LEFT JOIN sleep s ON s.day = d.day
            LEFT JOIN hrv_daily h ON h.day = d.day
            LEFT JOIN body_composition b ON b.day = d.day
            LEFT JOIN fitness f ON f.day = d.day
            GROUP BY month
            """
        )
    }
    out = []
    for i, r in enumerate(rows):
        w = wellness.get(r["month"], {})
        prev = rows[i - 1] if i else {}
        out.append(
            {
                "month": r["month"],
                "sessions": r["sessions"],
                "km": round(float(r["km"] or 0), 1),
                "run_km": round(float(r["run_km"] or 0), 1),
                "hours": round(float(r["hours"] or 0), 2),
                "trimp": round(float(r["trimp"] or 0), 1),
                "elev_m": round(float(r["elev_m"] or 0)),
                "rhr": round(float(w["rhr"]), 1) if w.get("rhr") else None,
                "hrv": round(float(w["hrv"]), 1) if w.get("hrv") else None,
                "sleep_score": round(float(w["sleep_score"]), 1) if w.get("sleep_score") else None,
                "weight_kg": round(float(w["weight_kg"]), 1) if w.get("weight_kg") else None,
                "vo2max": round(float(w["vo2max"]), 1) if w.get("vo2max") else None,
                "km_delta_pct": pct_delta(r["run_km"], prev.get("run_km")),
                "trimp_delta_pct": pct_delta(r["trimp"], prev.get("trimp")),
            }
        )
    return out[-limit:]


def compute_reports(store) -> dict[str, object]:
    act_days = [
        r["day"]
        for r in store.query("SELECT DISTINCT day FROM v_activities_included ORDER BY day")
    ]
    wear_days = [r["day"] for r in store.query("SELECT DISTINCT day FROM daily_wellness ORDER BY day")]
    return {
        "weekly": weekly_report(store),
        "monthly": monthly_report(store),
        "streaks": {
            "longest_active": longest_streak(act_days),
            "current_active": current_streak(act_days, _last_day(store)),
            "longest_wear": longest_streak(wear_days),
        },
        "weekday_consistency": weekday_consistency(act_days),
        "totals": {
            "activities": len(
                store.query("SELECT activity_id FROM v_activities_included")
            ),
            "active_days": len(act_days),
            "tracked_days": len(wear_days),
            "total_km": round(
                float(store.scalar("SELECT SUM(distance_m) FROM v_activities_included") or 0) / 1000.0, 1
            ),
            "total_run_km": round(
                float(
                    store.scalar(
                        "SELECT SUM(distance_m) FROM v_activities_included "
                        "WHERE activity_type = 'running'"
                    )
                    or 0
                )
                / 1000.0,
                1,
            ),
            "total_hours": round(
                float(
                    store.scalar(
                        "SELECT SUM(COALESCE(moving_time_s, duration_s)) FROM v_activities_included"
                    )
                    or 0
                )
                / 3600.0,
                1,
            ),
        },
    }


def _last_day(store) -> date | None:
    d = store.scalar("SELECT MAX(day) FROM daily_wellness")
    return date.fromisoformat(d) if d else None
