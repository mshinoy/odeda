"""Performance: best efforts, Riegel projection, aerobic decoupling, efficiency factor.

All the pure maths sits at the top and takes plain sequences, so the fixtures in
tests/ can be hand-checked without a database or a FIT file.
"""

from __future__ import annotations

from typing import Mapping, Sequence

# Distances the best-effort extractor looks for, in metres.
STANDARD_DISTANCES = [1000, 1609.34, 5000, 10000, 15000, 21097.5, 42195]
DISTANCE_LABELS = {
    1000: "1 k",
    1609.34: "1 mile",
    5000: "5 k",
    10000: "10 k",
    15000: "15 k",
    21097.5: "HM",
    42195: "M",
}

RIEGEL_EXPONENT = 1.06
DECOUPLING_MIN_DURATION_S = 40 * 60  # spec: runs longer than 40 minutes


def riegel(known_time_s: float, known_distance_m: float, target_distance_m: float,
           exponent: float = RIEGEL_EXPONENT) -> float:
    """Riegel endurance projection: T2 = T1 * (D2/D1)^1.06.

    Raises on non-positive inputs rather than silently returning nonsense — a
    zero-distance "effort" is a data bug, not a fast run.
    """
    if known_time_s <= 0 or known_distance_m <= 0 or target_distance_m <= 0:
        raise ValueError("distances and times must be positive")
    return known_time_s * (target_distance_m / known_distance_m) ** exponent


def best_effort_for_distance(
    cum_distance_m: Sequence[float],
    elapsed_s: Sequence[float],
    target_m: float,
) -> float | None:
    """Fastest time to cover `target_m` anywhere inside a sample stream.

    Both inputs must be monotonically non-decreasing and the same length. Uses a
    two-pointer sweep with linear interpolation at the trailing edge, so a 5 k best
    is not quantised to whatever the sample interval happens to be.
    Returns None if the activity never covers the distance.
    """
    n = len(cum_distance_m)
    if n < 2 or len(elapsed_s) != n:
        return None
    if cum_distance_m[-1] - cum_distance_m[0] < target_m:
        return None

    best: float | None = None
    start = 0
    for end in range(1, n):
        # Advance `start` while the window is still at least `target_m` long.
        while start < end and (cum_distance_m[end] - cum_distance_m[start + 1]) >= target_m:
            start += 1
        span = cum_distance_m[end] - cum_distance_m[start]
        if span < target_m:
            continue
        # Interpolate the entry point between `start` and `start+1`.
        seg = cum_distance_m[start + 1] - cum_distance_m[start]
        overshoot = span - target_m
        if seg > 0 and overshoot > 0:
            frac = min(overshoot / seg, 1.0)
            t_start = elapsed_s[start] + frac * (elapsed_s[start + 1] - elapsed_s[start])
        else:
            t_start = elapsed_s[start]
        duration = elapsed_s[end] - t_start
        if duration > 0 and (best is None or duration < best):
            best = duration
    return best


def efficiency_factor(distance_m: float, duration_s: float, avg_hr: float) -> float | None:
    """Metres per minute per heartbeat-per-minute. Higher is more aerobically efficient."""
    if duration_s <= 0 or not avg_hr or avg_hr <= 0:
        return None
    speed_m_per_min = distance_m / (duration_s / 60.0)
    return speed_m_per_min / avg_hr


def aerobic_decoupling(
    elapsed_s: Sequence[float],
    distance_m: Sequence[float],
    hr: Sequence[float | None],
) -> float | None:
    """Percent drift in speed:HR between the first and second half of an effort.

    Split is by elapsed time at the midpoint. Positive = the second half cost more
    heartbeats per metre (aerobic decoupling). Friel's rule of thumb: >5 % means the
    aerobic base is not yet supporting that intensity for that duration.

    Returns None if either half lacks usable HR or distance.
    """
    n = len(elapsed_s)
    if n < 4 or len(distance_m) != n or len(hr) != n:
        return None
    total = elapsed_s[-1] - elapsed_s[0]
    if total <= 0:
        return None
    mid_t = elapsed_s[0] + total / 2.0

    # Index of the first sample at or past the midpoint.
    split = next((i for i, t in enumerate(elapsed_s) if t >= mid_t), None)
    if split is None or split < 1 or split > n - 2:
        return None

    def half(lo: int, hi: int) -> float | None:
        dt = elapsed_s[hi] - elapsed_s[lo]
        dd = distance_m[hi] - distance_m[lo]
        hrs = [float(h) for h in hr[lo : hi + 1] if h is not None]
        if dt <= 0 or dd <= 0 or not hrs:
            return None
        mean_hr = sum(hrs) / len(hrs)
        if mean_hr <= 0:
            return None
        return (dd / dt) / mean_hr  # metres per second per bpm

    first = half(0, split)
    second = half(split, n - 1)
    if first is None or second is None or first <= 0:
        return None
    return (first - second) / first * 100.0


def pace_str(seconds_per_km: float) -> str:
    m, s = divmod(int(round(seconds_per_km)), 60)
    return f"{m}:{s:02d}/km"


def hms(seconds: float) -> str:
    total = int(round(seconds))
    h, rem = divmod(total, 3600)
    m, s = divmod(rem, 60)
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"


# ---------------------------------------------------------------------------
# Store-backed
# ---------------------------------------------------------------------------


def extract_best_efforts(store, activity_id: str) -> list[dict[str, float]]:
    """Recompute best efforts for one activity from its stored sample stream."""
    rows = store.query(
        "SELECT elapsed_s, distance_m FROM activity_samples "
        "WHERE activity_id = ? AND distance_m IS NOT NULL ORDER BY elapsed_s",
        (activity_id,),
    )
    if len(rows) < 2:
        return []
    elapsed = [float(r["elapsed_s"]) for r in rows]
    dist = [float(r["distance_m"]) for r in rows]
    day = store.scalar("SELECT day FROM activities WHERE activity_id = ?", (activity_id,))
    out = []
    for target in STANDARD_DISTANCES:
        t = best_effort_for_distance(dist, elapsed, target)
        if t is not None:
            out.append(
                {"activity_id": activity_id, "distance_m": target, "seconds": t, "day": day}
            )
    return out


def rebuild_best_efforts(store, activity_ids: Sequence[str] | None = None) -> int:
    ids = activity_ids or [
        r["activity_id"]
        for r in store.query(
            "SELECT DISTINCT activity_id FROM activity_samples"
        )
    ]
    n = 0
    with store.tx():
        for aid in ids:
            for row in extract_best_efforts(store, aid):
                store.upsert("best_efforts", ["activity_id", "distance_m"], row)
                n += 1
    return n


def personal_bests(store, since_day: str | None = None) -> list[dict[str, object]]:
    """Best effort per standard distance, optionally restricted to recent history."""
    out = []
    for target in STANDARD_DISTANCES:
        sql = "SELECT * FROM best_efforts WHERE distance_m = ?"
        params: list[object] = [target]
        if since_day:
            sql += " AND day >= ?"
            params.append(since_day)
        sql += " ORDER BY seconds LIMIT 1"
        rows = store.query(sql, params)
        if not rows:
            continue
        r = rows[0]
        secs = float(r["seconds"])
        out.append(
            {
                "distance_m": target,
                "label": DISTANCE_LABELS.get(target, f"{target:.0f} m"),
                "seconds": round(secs, 1),
                "time": hms(secs),
                "pace": pace_str(secs / (target / 1000.0)),
                "day": r["day"],
                "activity_id": r["activity_id"],
            }
        )
    return out


def decoupling_history(store, min_duration_s: float = DECOUPLING_MIN_DURATION_S) -> list[dict]:
    """Decoupling and efficiency factor for every long run with a sample stream."""
    acts = store.query(
        """
        SELECT a.activity_id, a.day, a.activity_name, a.distance_m, a.moving_time_s, a.avg_hr
        FROM activities a
        WHERE a.activity_type = 'running'
          AND COALESCE(a.moving_time_s, a.duration_s) >= ?
        ORDER BY a.day
        """,
        (min_duration_s,),
    )
    out = []
    for a in acts:
        rows = store.query(
            "SELECT elapsed_s, distance_m, hr FROM activity_samples "
            "WHERE activity_id = ? ORDER BY elapsed_s",
            (a["activity_id"],),
        )
        if len(rows) < 4:
            continue
        dec = aerobic_decoupling(
            [float(r["elapsed_s"]) for r in rows],
            [float(r["distance_m"] or 0) for r in rows],
            [r["hr"] for r in rows],
        )
        ef = efficiency_factor(
            float(a["distance_m"] or 0), float(a["moving_time_s"] or 0), float(a["avg_hr"] or 0)
        )
        if dec is None and ef is None:
            continue
        out.append(
            {
                "activity_id": a["activity_id"],
                "day": a["day"],
                "name": a["activity_name"],
                "distance_km": round(float(a["distance_m"] or 0) / 1000.0, 2),
                "duration_s": a["moving_time_s"],
                "decoupling_pct": None if dec is None else round(dec, 2),
                "efficiency_factor": None if ef is None else round(ef, 3),
                "aerobically_durable": bool(dec is not None and dec <= 5.0),
            }
        )
    return out


def vo2max_trend(store) -> list[dict[str, object]]:
    return store.query(
        "SELECT day, vo2max_run FROM fitness WHERE vo2max_run IS NOT NULL ORDER BY day"
    )


def compute_performance(store) -> dict[str, object]:
    pbs_all = personal_bests(store)
    pbs_90 = personal_bests(store, since_day=_days_ago(store, 90))
    dec = decoupling_history(store)
    return {
        "personal_bests": pbs_all,
        "recent_bests_90d": pbs_90,
        "decoupling": dec,
        "decoupling_recent": dec[-12:],
        "vo2max": vo2max_trend(store),
        "efficiency_trend": [
            {"day": d["day"], "ef": d["efficiency_factor"]}
            for d in dec
            if d["efficiency_factor"] is not None
        ],
    }


def _days_ago(store, n: int) -> str | None:
    from datetime import date, timedelta

    hi = store.scalar("SELECT MAX(day) FROM activities")
    if not hi:
        return None
    return (date.fromisoformat(hi) - timedelta(days=n)).isoformat()
