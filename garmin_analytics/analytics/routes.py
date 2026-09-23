"""Routes: clustering repeated GPS tracks, per-route history, segment analysis.

The problem this solves: someone runs the same 8 km loop 47 times over four years.
Garmin shows 47 unrelated activities. What they actually want is *one route* with 47
attempts, a trend line, and an answer to "where do I always slow down?".

How the clustering works
------------------------
1. Each GPS track is **resampled to a fixed number of points by distance**, so two
   runs of the same loop line up index-for-index regardless of pace or sample rate.
2. Candidates are narrowed by centroid proximity and total-distance ratio — cheap
   filters that avoid comparing a Doha loop with a track in another country.
3. Two tracks are compared by **symmetric path overlap**: the fraction of A's points
   lying within `TOLERANCE_M` of B's polyline, and vice versa, taking the worse of
   the two. Taking the minimum is what stops a 5 km out-and-back being swallowed by
   the 10 km route that contains it.
4. Above `MATCH_THRESHOLD` the activity joins the route; otherwise it starts a new one.

Clustering is a heuristic and will get some wrong, so every result is editable:
rename, merge, split, or move a single activity. A route the user has touched is
`pinned` and automatic clustering will not re-file its members.

Indoor activities simply have no GPS. Every function here treats "no track" as an
ordinary, expected case and returns empty rather than raising.
"""

from __future__ import annotations

import json
import math
import statistics
from typing import Any, Iterable, Sequence

from ..db.store import Store, utcnow

#: Mean Earth radius (IUGG), metres.
EARTH_R = 6371008.8

#: Points each track is resampled to before comparison. 100 points on an 8 km loop
#: is a point every 80 m — fine enough to tell two parallel streets apart.
RESAMPLE_N = 100

#: How far off the line a point may be and still count as "on the route".
#: 45 m tolerates GPS drift and opposite pavements without merging parallel roads.
TOLERANCE_M = 45.0

#: Symmetric overlap needed to call two tracks the same route.
MATCH_THRESHOLD = 0.80

#: Candidate pre-filters, applied before the expensive overlap computation.
CENTROID_TOL_M = 3000.0
DISTANCE_RATIO_TOL = 0.25

#: A track whose start and end are this close is a loop.
LOOP_TOL_M = 250.0

#: Minimum GPS points and metres for a track to be worth clustering at all.
MIN_POINTS = 10
MIN_DISTANCE_M = 400.0

#: Geohash-ish grid for the lifetime heatmap, in degrees (~11 m at the equator).
HEATMAP_PRECISION = 4


# ---------------------------------------------------------------------------
# Geometry
# ---------------------------------------------------------------------------


def haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in metres."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_R * math.asin(math.sqrt(min(1.0, a)))


def _project(lat: float, lon: float, lat0: float) -> tuple[float, float]:
    """Equirectangular metres about a reference latitude.

    Over the few kilometres a route spans this is accurate to well under the GPS
    noise we are already tolerating, and it makes point-to-segment distance a
    plain 2-D calculation instead of a spherical one.
    """
    x = math.radians(lon) * math.cos(math.radians(lat0)) * EARTH_R
    y = math.radians(lat) * EARTH_R
    return x, y


def _point_segment_distance(
    px: float, py: float, ax: float, ay: float, bx: float, by: float
) -> float:
    """Distance from point P to segment AB, all in projected metres."""
    dx, dy = bx - ax, by - ay
    if dx == 0.0 and dy == 0.0:
        return math.hypot(px - ax, py - ay)
    t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)
    t = max(0.0, min(1.0, t))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def _fraction_within(a: Sequence[tuple[float, float]],
                     b: Sequence[tuple[float, float]],
                     tolerance_m: float, lat0: float) -> float:
    """Fraction of A's points lying within `tolerance_m` of B's polyline."""
    if not a or len(b) < 2:
        return 0.0
    bp = [_project(lat, lon, lat0) for lat, lon in b]
    hits = 0
    for lat, lon in a:
        px, py = _project(lat, lon, lat0)
        best = float("inf")
        for i in range(len(bp) - 1):
            d = _point_segment_distance(px, py, bp[i][0], bp[i][1], bp[i + 1][0], bp[i + 1][1])
            if d < best:
                best = d
                if best <= tolerance_m:
                    break
        if best <= tolerance_m:
            hits += 1
    return hits / len(a)


def similarity(
    a: Sequence[tuple[float, float]],
    b: Sequence[tuple[float, float]],
    tolerance_m: float = TOLERANCE_M,
) -> float:
    """Symmetric path overlap in 0..1.

    The minimum of the two directional overlaps: a short track that runs along part
    of a long one scores low, which is what stops routes swallowing their subsets.
    """
    if not a or not b:
        return 0.0
    lat0 = a[0][0]
    return min(
        _fraction_within(a, b, tolerance_m, lat0),
        _fraction_within(b, a, tolerance_m, lat0),
    )


def resample(points: Sequence[tuple[float, float]], n: int = RESAMPLE_N) -> list[tuple[float, float]]:
    """Resample a track to `n` points spaced evenly **by distance along the path**.

    Distance-based rather than time-based so that a slow run and a fast run of the
    same route produce the same point sequence.
    """
    pts = [p for p in points if p is not None]
    if len(pts) < 2:
        return list(pts)
    cum = [0.0]
    for i in range(1, len(pts)):
        cum.append(cum[-1] + haversine(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]))
    total = cum[-1]
    if total <= 0:
        return [pts[0]] * min(n, len(pts))

    out: list[tuple[float, float]] = []
    j = 0
    for k in range(n):
        target = total * k / (n - 1)
        while j < len(cum) - 2 and cum[j + 1] < target:
            j += 1
        span = cum[j + 1] - cum[j]
        t = 0.0 if span <= 0 else (target - cum[j]) / span
        lat = pts[j][0] + t * (pts[j + 1][0] - pts[j][0])
        lon = pts[j][1] + t * (pts[j + 1][1] - pts[j][1])
        out.append((lat, lon))
    return out


def signature(points: Sequence[tuple[float, float]], precision: int = 3) -> str:
    """A coarse, grid-snapped fingerprint — a cheap pre-filter and a debugging aid."""
    return "|".join(f"{lat:.{precision}f},{lon:.{precision}f}" for lat, lon in points)


def path_length(points: Sequence[tuple[float, float]]) -> float:
    return sum(
        haversine(points[i - 1][0], points[i - 1][1], points[i][0], points[i][1])
        for i in range(1, len(points))
    )


# ---------------------------------------------------------------------------
# Track loading
# ---------------------------------------------------------------------------


def track_rows(store: Store, activity_id: str) -> list[dict[str, Any]]:
    """Full GPS-bearing sample stream for one activity. Empty for indoor activities."""
    return store.query(
        "SELECT elapsed_s, distance_m, hr, speed_mps, cadence_spm, altitude_m, lat, lon "
        "FROM activity_samples WHERE activity_id = ? AND lat IS NOT NULL AND lon IS NOT NULL "
        "ORDER BY elapsed_s",
        (activity_id,),
    )


def gps_activity_ids(store: Store, activity_type: str | None = None) -> list[str]:
    """Activities that actually have a usable track, oldest first."""
    sql = (
        "SELECT v.activity_id FROM v_activities v "
        "WHERE EXISTS (SELECT 1 FROM activity_samples s "
        "              WHERE s.activity_id = v.activity_id AND s.lat IS NOT NULL) "
    )
    params: list[Any] = []
    if activity_type:
        sql += "AND v.activity_type = ? "
        params.append(activity_type)
    sql += "ORDER BY v.day, v.activity_id"
    return [r["activity_id"] for r in store.query(sql, params)]


# ---------------------------------------------------------------------------
# Clustering
# ---------------------------------------------------------------------------


def _auto_name(distance_m: float, is_loop: bool, ordinal: int) -> str:
    km = distance_m / 1000.0
    shape = "loop" if is_loop else "route"
    return f"{km:.1f} km {shape} #{ordinal}"


def _route_points_json(
    resampled: Sequence[tuple[float, float]], rows: Sequence[dict[str, Any]]
) -> str:
    """Representative polyline as [[lat, lon, altitude_m, cumulative_m], ...].

    Altitude and cumulative distance ride along so the map, the elevation profile
    and the segment boundaries all come from one array.
    """
    alt_by_index = _resampled_altitudes(rows, len(resampled))
    out = []
    cum = 0.0
    for i, (lat, lon) in enumerate(resampled):
        if i:
            cum += haversine(resampled[i - 1][0], resampled[i - 1][1], lat, lon)
        out.append([round(lat, 6), round(lon, 6), alt_by_index[i], round(cum, 1)])
    return json.dumps(out, separators=(",", ":"))


def _resampled_altitudes(rows: Sequence[dict[str, Any]], n: int) -> list[float | None]:
    alts = [r.get("altitude_m") for r in rows]
    if not alts or all(a is None for a in alts):
        return [None] * n
    known = [(i, float(a)) for i, a in enumerate(alts) if a is not None]
    out: list[float | None] = []
    for k in range(n):
        src = int(round(k * (len(alts) - 1) / max(n - 1, 1)))
        nearest = min(known, key=lambda p: abs(p[0] - src))
        out.append(round(nearest[1], 1))
    return out


def _candidate_routes(
    store: Store, activity_type: str, centroid: tuple[float, float], distance_m: float
) -> list[dict[str, Any]]:
    """Cheap pre-filter: same sport, nearby centroid, comparable total distance."""
    rows = store.query(
        "SELECT * FROM routes WHERE activity_type = ?", (activity_type,)
    )
    out = []
    for r in rows:
        if haversine(centroid[0], centroid[1], r["centroid_lat"], r["centroid_lon"]) > CENTROID_TOL_M:
            continue
        rd = float(r["distance_m"] or 0)
        if rd <= 0:
            continue
        if abs(rd - distance_m) / max(rd, distance_m) > DISTANCE_RATIO_TOL:
            continue
        out.append(r)
    return out


def cluster_activity(
    store: Store, activity_id: str, threshold: float = MATCH_THRESHOLD
) -> dict[str, Any]:
    """File one activity into a route, creating one if nothing matches.

    Returns a dict describing what happened; `route_id` is None when the activity
    has no usable track (indoor, or GPS lost).
    """
    row = store.conn.execute(
        "SELECT activity_type, distance_m, elevation_gain_m FROM v_activities "
        "WHERE activity_id = ?",
        (activity_id,),
    ).fetchone()
    if row is None:
        raise LookupError(f"no activity {activity_id!r}")

    existing = store.conn.execute(
        "SELECT rm.route_id, rm.assigned, r.pinned FROM route_members rm "
        "JOIN routes r ON r.route_id = rm.route_id WHERE rm.activity_id = ?",
        (activity_id,),
    ).fetchone()
    if existing and (existing["assigned"] == "manual" or existing["pinned"]):
        # The user has already decided where this belongs. Leave it alone.
        return {
            "activity_id": activity_id,
            "route_id": int(existing["route_id"]),
            "action": "kept_manual",
        }

    rows = track_rows(store, activity_id)
    pts = [(float(r["lat"]), float(r["lon"])) for r in rows]
    if len(pts) < MIN_POINTS:
        return {"activity_id": activity_id, "route_id": None, "action": "no_gps"}

    length = path_length(pts)
    if length < MIN_DISTANCE_M:
        return {"activity_id": activity_id, "route_id": None, "action": "too_short"}

    sampled = resample(pts)
    centroid = (
        sum(p[0] for p in sampled) / len(sampled),
        sum(p[1] for p in sampled) / len(sampled),
    )
    activity_type = row["activity_type"]

    best_route, best_score = None, 0.0
    for cand in _candidate_routes(store, activity_type, centroid, length):
        cand_pts = [(p[0], p[1]) for p in json.loads(cand["points"])]
        score = similarity(sampled, cand_pts)
        if score > best_score:
            best_route, best_score = cand, score

    now = utcnow()
    if best_route is not None and best_score >= threshold:
        route_id = int(best_route["route_id"])
        action = "joined"
    else:
        is_loop = haversine(pts[0][0], pts[0][1], pts[-1][0], pts[-1][1]) <= LOOP_TOL_M
        ordinal = int(store.scalar("SELECT COUNT(*) FROM routes") or 0) + 1
        cur = store.conn.execute(
            """
            INSERT INTO routes (name, activity_type, signature, points, distance_m,
                                elevation_gain_m, start_lat, start_lon, end_lat, end_lon,
                                centroid_lat, centroid_lon, is_loop, pinned,
                                created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
            """,
            (
                _auto_name(length, is_loop, ordinal),
                activity_type,
                signature(sampled),
                _route_points_json(sampled, rows),
                length,
                row["elevation_gain_m"],
                pts[0][0], pts[0][1], pts[-1][0], pts[-1][1],
                centroid[0], centroid[1],
                int(is_loop),
                now, now,
            ),
        )
        route_id = int(cur.lastrowid)  # type: ignore[arg-type]
        action = "created"
        best_score = 1.0

    store.upsert(
        "route_members",
        ["activity_id"],
        {
            "activity_id": activity_id,
            "route_id": route_id,
            "match_score": round(best_score, 4),
            "assigned": "auto",
            "assigned_at": now,
        },
    )
    store.conn.commit()
    return {
        "activity_id": activity_id,
        "route_id": route_id,
        "action": action,
        "score": round(best_score, 4),
    }


def cluster_all(
    store: Store,
    activity_ids: Iterable[str] | None = None,
    threshold: float = MATCH_THRESHOLD,
    progress: Any = None,
    recompute_segments: bool = True,
) -> dict[str, Any]:
    """Cluster every GPS activity (or a given subset) and rebuild segment efforts."""
    ids = list(activity_ids) if activity_ids is not None else gps_activity_ids(store)
    counts = {"created": 0, "joined": 0, "no_gps": 0, "too_short": 0, "kept_manual": 0}
    touched: set[int] = set()
    for i, aid in enumerate(ids, 1):
        result = cluster_activity(store, aid, threshold)
        counts[result["action"]] = counts.get(result["action"], 0) + 1
        if result["route_id"]:
            touched.add(int(result["route_id"]))
        if progress and i % 25 == 0:
            progress(f"clustering {i}/{len(ids)}")

    for route_id in touched:
        refresh_route(store, route_id, recompute_segments=recompute_segments)

    return {
        "activities": len(ids),
        "routes": int(store.scalar("SELECT COUNT(*) FROM routes") or 0),
        **counts,
    }


def refresh_route(store: Store, route_id: int, recompute_segments: bool = True) -> None:
    """Recompute a route's derived geometry and its cached segment efforts."""
    members = [
        r["activity_id"]
        for r in store.query(
            "SELECT activity_id FROM route_members WHERE route_id = ?", (route_id,)
        )
    ]
    if not members:
        store.conn.execute("DELETE FROM routes WHERE route_id = ?", (route_id,))
        store.conn.commit()
        return

    # The representative track is the *median-length* attempt: robust to one run
    # where the GPS wandered, and always a real track the user actually ran.
    lengths: list[tuple[float, str, list[dict[str, Any]]]] = []
    for aid in members:
        rows = track_rows(store, aid)
        pts = [(float(r["lat"]), float(r["lon"])) for r in rows]
        if len(pts) >= MIN_POINTS:
            lengths.append((path_length(pts), aid, rows))
    if not lengths:
        return
    lengths.sort(key=lambda t: t[0])
    length, _aid, rows = lengths[len(lengths) // 2]
    pts = [(float(r["lat"]), float(r["lon"])) for r in rows]
    sampled = resample(pts)
    is_loop = haversine(pts[0][0], pts[0][1], pts[-1][0], pts[-1][1]) <= LOOP_TOL_M

    store.conn.execute(
        """
        UPDATE routes SET signature = ?, points = ?, distance_m = ?, start_lat = ?,
               start_lon = ?, end_lat = ?, end_lon = ?, centroid_lat = ?,
               centroid_lon = ?, is_loop = ?, updated_at = ?
        WHERE route_id = ?
        """,
        (
            signature(sampled),
            _route_points_json(sampled, rows),
            length,
            pts[0][0], pts[0][1], pts[-1][0], pts[-1][1],
            sum(p[0] for p in sampled) / len(sampled),
            sum(p[1] for p in sampled) / len(sampled),
            int(is_loop),
            utcnow(),
            route_id,
        ),
    )
    store.conn.commit()
    if recompute_segments:
        compute_segments(store, route_id)


# ---------------------------------------------------------------------------
# Segment analysis — where you speed up and slow down
# ---------------------------------------------------------------------------


def segment_length_for(distance_m: float) -> float:
    """Pick a segment size that yields a readable number of bars, not 200 of them."""
    if distance_m <= 12000:
        return 200.0
    if distance_m <= 30000:
        return 500.0
    return 1000.0


def compute_segments(store: Store, route_id: int, segment_m: float | None = None) -> int:
    """Split every attempt at this route into fixed-distance segments and cache them.

    Each attempt is walked using *its own* cumulative distance, so segment k always
    covers the same stretch of road regardless of how fast that day went.
    """
    route = store.conn.execute(
        "SELECT * FROM routes WHERE route_id = ?", (route_id,)
    ).fetchone()
    if route is None:
        return 0
    seg_m = segment_m or segment_length_for(float(route["distance_m"]))
    members = [
        r["activity_id"]
        for r in store.query(
            "SELECT activity_id FROM route_members WHERE route_id = ?", (route_id,)
        )
    ]
    store.conn.execute("DELETE FROM route_segment_efforts WHERE route_id = ?", (route_id,))

    written = 0
    for aid in members:
        rows = track_rows(store, aid)
        if len(rows) < 2:
            continue
        for eff in _segment_activity(rows, seg_m):
            store.upsert(
                "route_segment_efforts",
                ["route_id", "activity_id", "seg_index"],
                {"route_id": route_id, "activity_id": aid, **eff},
            )
            written += 1
    store.conn.commit()
    return written


def _segment_activity(rows: Sequence[dict[str, Any]], seg_m: float) -> list[dict[str, Any]]:
    """Per-segment time, speed, HR, cadence and gradient for one attempt."""
    # Some devices give distance directly; otherwise integrate the track.
    dist = [r.get("distance_m") for r in rows]
    if any(d is None for d in dist):
        dist = [0.0]
        for i in range(1, len(rows)):
            dist.append(
                dist[-1]
                + haversine(
                    float(rows[i - 1]["lat"]), float(rows[i - 1]["lon"]),
                    float(rows[i]["lat"]), float(rows[i]["lon"]),
                )
            )
    dist = [float(d or 0.0) for d in dist]
    total = dist[-1]
    if total < seg_m:
        return []

    out: list[dict[str, Any]] = []
    n_segments = int(total // seg_m)
    idx = 0
    for k in range(n_segments):
        start_m, end_m = k * seg_m, (k + 1) * seg_m
        while idx < len(rows) - 1 and dist[idx] < start_m:
            idx += 1
        start_i = idx
        j = idx
        while j < len(rows) - 1 and dist[j] < end_m:
            j += 1
        end_i = j
        if end_i <= start_i:
            continue

        seconds = float(rows[end_i]["elapsed_s"]) - float(rows[start_i]["elapsed_s"])
        if seconds <= 0:
            continue
        window = rows[start_i : end_i + 1]
        hrs = [float(r["hr"]) for r in window if r.get("hr") is not None]
        cads = [float(r["cadence_spm"]) for r in window if r.get("cadence_spm") is not None]
        alts = [float(r["altitude_m"]) for r in window if r.get("altitude_m") is not None]
        rise = (alts[-1] - alts[0]) if len(alts) >= 2 else None
        run = dist[end_i] - dist[start_i]

        out.append(
            {
                "seg_index": k,
                "start_m": start_m,
                "end_m": end_m,
                "seconds": round(seconds, 2),
                "speed_mps": round(run / seconds, 4) if seconds else None,
                "avg_hr": round(sum(hrs) / len(hrs), 1) if hrs else None,
                "avg_cadence_spm": round(sum(cads) / len(cads), 1) if cads else None,
                "gradient_pct": (
                    round(100.0 * rise / run, 2) if rise is not None and run > 0 else None
                ),
            }
        )
    return out


def segment_profile(store: Store, route_id: int) -> dict[str, Any]:
    """Aggregate segments across every attempt: the speed-up/slow-down profile.

    `relative_speed` is the key column. Each attempt's segment speed is divided by
    *that attempt's own* average speed before aggregating, so the profile shows
    where this route is fast or slow rather than which days were fast or slow.
    A value below 1 means consistently slower than your own average there — a hill,
    a junction, or the point at which you fade.
    """
    route = store.conn.execute(
        "SELECT * FROM routes WHERE route_id = ?", (route_id,)
    ).fetchone()
    if route is None:
        raise LookupError(f"no route {route_id}")

    efforts = store.query(
        "SELECT * FROM route_segment_efforts WHERE route_id = ? ORDER BY seg_index",
        (route_id,),
    )
    if not efforts:
        return {"route_id": route_id, "segments": [], "segment_m": None, "attempts": 0}

    per_activity_mean: dict[str, float] = {}
    by_activity: dict[str, list[dict[str, Any]]] = {}
    for e in efforts:
        by_activity.setdefault(e["activity_id"], []).append(e)
    for aid, rows in by_activity.items():
        speeds = [float(r["speed_mps"]) for r in rows if r["speed_mps"]]
        if speeds:
            per_activity_mean[aid] = sum(speeds) / len(speeds)

    by_segment: dict[int, list[dict[str, Any]]] = {}
    for e in efforts:
        by_segment.setdefault(int(e["seg_index"]), []).append(e)

    points = json.loads(route["points"])
    seg_m = float(efforts[0]["end_m"]) - float(efforts[0]["start_m"])

    segments: list[dict[str, Any]] = []
    for idx in sorted(by_segment):
        group = by_segment[idx]
        speeds = [float(g["speed_mps"]) for g in group if g["speed_mps"]]
        rels = [
            float(g["speed_mps"]) / per_activity_mean[g["activity_id"]]
            for g in group
            if g["speed_mps"] and per_activity_mean.get(g["activity_id"])
        ]
        hrs = [float(g["avg_hr"]) for g in group if g["avg_hr"] is not None]
        cads = [float(g["avg_cadence_spm"]) for g in group if g["avg_cadence_spm"] is not None]
        grads = [float(g["gradient_pct"]) for g in group if g["gradient_pct"] is not None]
        secs = [float(g["seconds"]) for g in group if g["seconds"]]

        segments.append(
            {
                "seg_index": idx,
                "start_m": float(group[0]["start_m"]),
                "end_m": float(group[0]["end_m"]),
                "attempts": len(group),
                "median_speed_mps": _median(speeds),
                "median_pace_s_per_km": (
                    round(1000.0 / _median(speeds), 1) if _median(speeds) else None
                ),
                "fastest_speed_mps": round(max(speeds), 4) if speeds else None,
                "slowest_speed_mps": round(min(speeds), 4) if speeds else None,
                "speed_cv_pct": _cv(speeds),
                "relative_speed": _median(rels, digits=4),
                "median_hr": _median(hrs, digits=1),
                "median_cadence_spm": _median(cads, digits=1),
                "median_gradient_pct": _median(grads, digits=2),
                "median_seconds": _median(secs, digits=1),
                "path": _segment_path(points, float(group[0]["start_m"]), float(group[0]["end_m"])),
            }
        )

    ranked = [s for s in segments if s["relative_speed"] is not None]
    fastest = sorted(ranked, key=lambda s: -s["relative_speed"])[:3]
    slowest = sorted(ranked, key=lambda s: s["relative_speed"])[:3]

    return {
        "route_id": route_id,
        "name": route["name"],
        "segment_m": seg_m,
        "attempts": len(by_activity),
        "segments": segments,
        "fastest_segments": fastest,
        "slowest_segments": slowest,
    }


def _segment_path(points: Sequence[Sequence[float]], start_m: float, end_m: float) -> list[list[float]]:
    """The slice of the representative polyline covering one segment, for the map."""
    out = [[p[0], p[1]] for p in points if start_m <= (p[3] or 0) <= end_m]
    return out if len(out) >= 2 else []


def _median(values: Sequence[float], digits: int = 4) -> float | None:
    return round(statistics.median(values), digits) if values else None


def _cv(values: Sequence[float]) -> float | None:
    """Coefficient of variation, %: how consistent this segment is across attempts."""
    if len(values) < 2:
        return None
    mean = sum(values) / len(values)
    if mean <= 0:
        return None
    return round(100.0 * statistics.pstdev(values) / mean, 2)


# ---------------------------------------------------------------------------
# Reads
# ---------------------------------------------------------------------------


def list_routes(store: Store, activity_type: str | None = None) -> list[dict[str, Any]]:
    """Every route with its attempt count and headline stats, busiest first."""
    where, params = "", []
    if activity_type:
        where = "WHERE r.activity_type = ?"
        params.append(activity_type)
    rows = store.query(
        f"""
        SELECT r.route_id, r.name, r.activity_type, r.distance_m, r.is_loop, r.pinned,
               r.start_lat, r.start_lon, r.centroid_lat, r.centroid_lon,
               r.elevation_gain_m, r.created_at, r.updated_at,
               COUNT(m.activity_id)          AS attempts,
               MIN(v.day)                    AS first_day,
               MAX(v.day)                    AS last_day,
               AVG(v.moving_time_s)          AS avg_moving_time_s,
               MIN(v.moving_time_s)          AS best_moving_time_s,
               AVG(v.avg_hr)                 AS avg_hr
        FROM routes r
        LEFT JOIN route_members m ON m.route_id = r.route_id
        LEFT JOIN v_activities_included v ON v.activity_id = m.activity_id
        {where}
        GROUP BY r.route_id
        ORDER BY attempts DESC, r.distance_m DESC
        """,
        params,
    )
    for r in rows:
        r["distance_km"] = round(float(r["distance_m"] or 0) / 1000.0, 2)
        r["is_loop"] = bool(r["is_loop"])
        r["pinned"] = bool(r["pinned"])
    return rows


def route_detail(store: Store, route_id: int) -> dict[str, Any]:
    """One route: geometry, every attempt, and the trend across attempts."""
    route = store.conn.execute(
        "SELECT * FROM routes WHERE route_id = ?", (route_id,)
    ).fetchone()
    if route is None:
        raise LookupError(f"no route {route_id}")

    attempts = store.query(
        """
        SELECT v.activity_id, v.day, v.start_time_local, v.activity_name, v.distance_m,
               v.moving_time_s, v.duration_s, v.avg_hr, v.max_hr, v.avg_speed_mps,
               v.elevation_gain_m, v.avg_cadence_spm, v.rpe, v.excluded_from_stats,
               m.match_score, m.assigned
        FROM route_members m
        JOIN v_activities v ON v.activity_id = m.activity_id
        WHERE m.route_id = ?
        ORDER BY v.day, v.activity_id
        """,
        (route_id,),
    )
    counted = [a for a in attempts if not a.get("excluded_from_stats")]
    times = [float(a["moving_time_s"]) for a in counted if a.get("moving_time_s")]
    paces = [
        1000.0 / float(a["avg_speed_mps"])
        for a in counted
        if a.get("avg_speed_mps")
    ]

    best = min(counted, key=lambda a: a["moving_time_s"] or float("inf"), default=None)
    worst = max(counted, key=lambda a: a["moving_time_s"] or 0, default=None)

    return {
        "route": {
            **dict(route),
            "points": json.loads(route["points"]),
            "distance_km": round(float(route["distance_m"] or 0) / 1000.0, 2),
            "is_loop": bool(route["is_loop"]),
            "pinned": bool(route["pinned"]),
        },
        "attempts": attempts,
        "attempt_count": len(attempts),
        "counted_count": len(counted),
        "stats": {
            "best_time_s": min(times) if times else None,
            "worst_time_s": max(times) if times else None,
            "median_time_s": _median(times, digits=1),
            "avg_pace_s_per_km": round(sum(paces) / len(paces), 1) if paces else None,
            "best_pace_s_per_km": round(min(paces), 1) if paces else None,
            "improvement_s": (
                round(times[0] - times[-1], 1) if len(times) >= 2 else None
            ),
            "first_day": counted[0]["day"] if counted else None,
            "last_day": counted[-1]["day"] if counted else None,
        },
        "best_attempt": best,
        "worst_attempt": worst,
    }


def activity_track(store: Store, activity_id: str) -> dict[str, Any]:
    """The full stream for the map and the linked chart, plus the route it belongs to.

    Returned even when there is no GPS: `points` is simply empty and the UI shows
    the chart without a map rather than falling over.
    """
    rows = store.query(
        "SELECT elapsed_s, distance_m, hr, speed_mps, cadence_spm, altitude_m, lat, lon "
        "FROM activity_samples WHERE activity_id = ? ORDER BY elapsed_s",
        (activity_id,),
    )
    gps = [r for r in rows if r.get("lat") is not None and r.get("lon") is not None]
    member = store.conn.execute(
        "SELECT m.route_id, m.match_score, m.assigned, r.name FROM route_members m "
        "JOIN routes r ON r.route_id = m.route_id WHERE m.activity_id = ?",
        (activity_id,),
    ).fetchone()

    lats = [float(r["lat"]) for r in gps]
    lons = [float(r["lon"]) for r in gps]
    return {
        "activity_id": activity_id,
        "has_gps": bool(gps),
        "point_count": len(gps),
        "points": [
            [
                round(float(r["lat"]), 6),
                round(float(r["lon"]), 6),
                None if r["altitude_m"] is None else round(float(r["altitude_m"]), 1),
                None if r["distance_m"] is None else round(float(r["distance_m"]), 1),
                None if r["elapsed_s"] is None else round(float(r["elapsed_s"]), 1),
                None if r["hr"] is None else round(float(r["hr"]), 1),
                None if r["speed_mps"] is None else round(float(r["speed_mps"]), 3),
                None if r["cadence_spm"] is None else round(float(r["cadence_spm"]), 1),
            ]
            for r in gps
        ],
        "fields": ["lat", "lon", "altitude_m", "distance_m", "elapsed_s", "hr", "speed_mps", "cadence_spm"],
        "bounds": (
            {"min_lat": min(lats), "max_lat": max(lats),
             "min_lon": min(lons), "max_lon": max(lons)}
            if gps
            else None
        ),
        "route": dict(member) if member else None,
    }


def heatmap(
    store: Store,
    activity_type: str | None = None,
    start: str | None = None,
    end: str | None = None,
    precision: int = HEATMAP_PRECISION,
    limit: int = 60000,
) -> dict[str, Any]:
    """Lifetime GPS heatmap: every point, snapped to a grid and counted.

    Aggregating server-side keeps the payload to tens of thousands of cells instead
    of millions of raw points — the browser cannot usefully draw the latter anyway.
    """
    where = ["s.lat IS NOT NULL"]
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

    rows = store.query(
        f"""
        SELECT ROUND(s.lat, {precision}) AS lat, ROUND(s.lon, {precision}) AS lon,
               COUNT(*) AS n
        FROM activity_samples s
        JOIN v_activities_included v ON v.activity_id = s.activity_id
        WHERE {' AND '.join(where)}
        GROUP BY ROUND(s.lat, {precision}), ROUND(s.lon, {precision})
        ORDER BY n DESC
        LIMIT ?
        """,
        [*params, limit],
    )
    return {
        "precision": precision,
        "cells": len(rows),
        "max_count": max((int(r["n"]) for r in rows), default=0),
        "points": [[r["lat"], r["lon"], int(r["n"])] for r in rows],
    }


# ---------------------------------------------------------------------------
# User corrections to clustering
# ---------------------------------------------------------------------------


def rename(store: Store, route_id: int, name: str) -> dict[str, Any]:
    """Name a route. Naming it pins it: the clusterer stops second-guessing it."""
    name = (name or "").strip()
    if not name:
        raise ValueError("route name cannot be empty")
    cur = store.conn.execute(
        "UPDATE routes SET name = ?, pinned = 1, updated_at = ? WHERE route_id = ?",
        (name, utcnow(), route_id),
    )
    store.conn.commit()
    if not cur.rowcount:
        raise LookupError(f"no route {route_id}")
    return {"route_id": route_id, "name": name, "pinned": True}


def merge(store: Store, target_id: int, source_ids: Sequence[int]) -> dict[str, Any]:
    """Fold one or more routes into another. The clusterer got it wrong; fix it."""
    if store.conn.execute(
        "SELECT 1 FROM routes WHERE route_id = ?", (target_id,)
    ).fetchone() is None:
        raise LookupError(f"no route {target_id}")
    moved = 0
    for src in source_ids:
        if int(src) == int(target_id):
            continue
        cur = store.conn.execute(
            "UPDATE route_members SET route_id = ?, assigned = 'manual', assigned_at = ? "
            "WHERE route_id = ?",
            (target_id, utcnow(), src),
        )
        moved += cur.rowcount
        store.conn.execute("DELETE FROM route_segment_efforts WHERE route_id = ?", (src,))
        store.conn.execute("DELETE FROM routes WHERE route_id = ?", (src,))
    store.conn.execute(
        "UPDATE routes SET pinned = 1, updated_at = ? WHERE route_id = ?",
        (utcnow(), target_id),
    )
    store.conn.commit()
    refresh_route(store, target_id)
    return {"route_id": target_id, "merged": list(source_ids), "moved_activities": moved}


def split(
    store: Store, route_id: int, activity_ids: Sequence[str], name: str | None = None
) -> dict[str, Any]:
    """Pull activities out of a route into a new one of their own."""
    route = store.conn.execute(
        "SELECT * FROM routes WHERE route_id = ?", (route_id,)
    ).fetchone()
    if route is None:
        raise LookupError(f"no route {route_id}")
    ids = [
        a
        for a in activity_ids
        if store.conn.execute(
            "SELECT 1 FROM route_members WHERE route_id = ? AND activity_id = ?",
            (route_id, a),
        ).fetchone()
    ]
    if not ids:
        raise ValueError("none of those activities belong to this route")
    remaining = int(
        store.scalar("SELECT COUNT(*) FROM route_members WHERE route_id = ?", (route_id,)) or 0
    )
    if len(ids) >= remaining:
        raise ValueError("cannot split every activity out of a route; rename it instead")

    now = utcnow()
    cur = store.conn.execute(
        """
        INSERT INTO routes (name, activity_type, signature, points, distance_m,
                            elevation_gain_m, start_lat, start_lon, end_lat, end_lon,
                            centroid_lat, centroid_lon, is_loop, pinned, created_at, updated_at)
        SELECT ?, activity_type, signature, points, distance_m, elevation_gain_m,
               start_lat, start_lon, end_lat, end_lon, centroid_lat, centroid_lon,
               is_loop, 1, ?, ?
        FROM routes WHERE route_id = ?
        """,
        (name or f"{route['name']} (split)", now, now, route_id),
    )
    new_id = int(cur.lastrowid)  # type: ignore[arg-type]
    for aid in ids:
        store.conn.execute(
            "UPDATE route_members SET route_id = ?, assigned = 'manual', assigned_at = ? "
            "WHERE activity_id = ?",
            (new_id, now, aid),
        )
        store.conn.execute(
            "DELETE FROM route_segment_efforts WHERE route_id = ? AND activity_id = ?",
            (route_id, aid),
        )
    store.conn.execute(
        "UPDATE routes SET pinned = 1, updated_at = ? WHERE route_id = ?", (now, route_id)
    )
    store.conn.commit()
    refresh_route(store, route_id)
    refresh_route(store, new_id)
    return {"route_id": new_id, "from_route_id": route_id, "moved": len(ids)}


def move_activity(store: Store, activity_id: str, route_id: int) -> dict[str, Any]:
    """Refile a single activity onto a different route, by hand."""
    if store.conn.execute(
        "SELECT 1 FROM routes WHERE route_id = ?", (route_id,)
    ).fetchone() is None:
        raise LookupError(f"no route {route_id}")
    old = store.conn.execute(
        "SELECT route_id FROM route_members WHERE activity_id = ?", (activity_id,)
    ).fetchone()
    store.upsert(
        "route_members",
        ["activity_id"],
        {
            "activity_id": activity_id,
            "route_id": route_id,
            "match_score": None,
            "assigned": "manual",
            "assigned_at": utcnow(),
        },
    )
    store.conn.commit()
    if old:
        refresh_route(store, int(old["route_id"]))
    refresh_route(store, route_id)
    return {"activity_id": activity_id, "route_id": route_id, "assigned": "manual"}


def delete_route(store: Store, route_id: int) -> bool:
    """Drop a route. Its activities become unclustered, not deleted."""
    store.conn.execute("DELETE FROM route_members WHERE route_id = ?", (route_id,))
    store.conn.execute("DELETE FROM route_segment_efforts WHERE route_id = ?", (route_id,))
    cur = store.conn.execute("DELETE FROM routes WHERE route_id = ?", (route_id,))
    store.conn.commit()
    return cur.rowcount > 0


def compare(store: Store, activity_ids: Sequence[str]) -> dict[str, Any]:
    """Two (or more) attempts side by side, for the overlay view."""
    out = []
    for aid in activity_ids:
        track = activity_track(store, aid)
        row = store.conn.execute(
            "SELECT activity_id, day, activity_name, distance_m, moving_time_s, avg_hr, "
            "avg_speed_mps, elevation_gain_m FROM v_activities WHERE activity_id = ?",
            (aid,),
        ).fetchone()
        if row is None:
            continue
        out.append({"activity": dict(row), "track": track})
    return {"count": len(out), "attempts": out}
