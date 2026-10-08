"""Routes: clustering repeated GPS tracks, per-route history, segment analysis.

The problem this solves: someone runs the same 8 km loop 47 times over four years.
Garmin shows 47 unrelated activities. What they actually want is *one route* with 47
attempts, a trend line, and an answer to "where do I always slow down?".

How the clustering works
------------------------
A route is **ground**, not a distance. Three laps of a 1.6 km loop and one lap of it
are the same route; so is an out-and-back to the same turn, run once or twice. What
tells two routes apart is ground one of them covers and the other does not.

1. Tracks are **densified to a point every `GROUND_STEP_M`** along the path, so a
   slow run and a fast run, or a 1 s and a 5 s recording, line up the same way.
2. Candidates are narrowed by centroid proximity — a cheap filter that avoids
   comparing a Doha loop with a track in another country. There is no distance
   filter: a run's distance says how many laps it did, not where it went.
3. A run matches a route when both hold (`match_score`, the lower of the two):
   - **most of the distance run was on the route's ground** — laps count each time,
     so a short warm-up to get there does not spoil it, and a run that goes on far
     past the route does;
   - **most of the route's ground was run** — so a short out-and-back is never
     swallowed by the longer route that contains it.
4. At `MATCH_THRESHOLD` or above the activity joins the route; otherwise it starts a
   new one. A route's shape is **one lap** (`first_lap`): one time round a loop, or
   out and back once, so laps can be timed against it (`lap_splits`).

Clustering is a heuristic and will get some wrong, so every result is editable:
rename, merge, split, or move a single activity. A route the user has touched is
`pinned` and automatic clustering will not re-file its members.

Indoor activities simply have no GPS. Every function here treats "no track" as an
ordinary, expected case and returns empty rather than raising.
"""

from __future__ import annotations

import functools
import json
import math
import statistics
from typing import Any, Iterable, Sequence

from ..db.store import Store, utcnow

#: Mean Earth radius (IUGG), metres.
EARTH_R = 6371008.8

#: Points a track is resampled to by default (`resample`), e.g. for comparing tracks
#: side by side. A route's own shape uses `shape_points` instead.
RESAMPLE_N = 100

#: Spacing of a route's stored shape, and the most points it keeps: a point every
#: 25 m keeps a corner within the matching tolerance of the line between points.
SHAPE_SPACING_M = 25.0
SHAPE_MAX_POINTS = 600

#: Spacing tracks are densified to before they are matched.
GROUND_STEP_M = 20.0

#: How far off the line a point may be and still count as "on the route".
#: 45 m tolerates GPS drift and opposite pavements without merging parallel roads.
TOLERANCE_M = 45.0

#: Both shares `match_score` takes must reach this. 0.75 is the owner's "about 25%"
#: (PLAN D16): on the real history, out-and-backs whose turns differ by about a
#: quarter of the route group together, and one that runs much further does not.
MATCH_THRESHOLD = 0.75

#: Candidate pre-filter, applied before the expensive overlap computation.
CENTROID_TOL_M = 3000.0

#: A track whose start and end are this close is a loop.
LOOP_TOL_M = 250.0

#: A lap ends when the track comes back within this of the route's start. Tighter
#: than `LOOP_TOL_M`: it times laps, so where the line is drawn matters.
LAP_GATE_M = 50.0

#: A lap shorter or longer than this share of the route's lap is a cut corner, a
#: detour or a lost signal, and is not timed. On the real history 95% of laps are
#: within ±4%; the tail beyond these bounds was corners cut, and a cut corner must not
#: set the record.
LAP_MIN_SHARE = 0.94
LAP_MAX_SHARE = 1.08

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


XY = tuple[float, float]


def _densify(points: Sequence[tuple[float, float]], lat0: float,
             step_m: float = GROUND_STEP_M) -> list[XY]:
    """The track in local metres, with a point every `step_m` along it."""
    xy = [_project(lat, lon, lat0) for lat, lon in points]
    if len(xy) < 2:
        return xy
    out = [xy[0]]
    carry = 0.0  # distance already walked since the last emitted point
    for (x0, y0), (x1, y1) in zip(xy, xy[1:]):
        seg = math.hypot(x1 - x0, y1 - y0)
        if seg <= 0:
            continue
        pos = step_m - carry
        while pos <= seg:
            t = pos / seg
            out.append((x0 + t * (x1 - x0), y0 + t * (y1 - y0)))
            pos += step_m
        carry = seg - (pos - step_m)
    if out[-1] != xy[-1]:
        out.append(xy[-1])
    return out


class _Near:
    """Answers "is there a point within `radius` of here?" without scanning them all."""

    def __init__(self, points: Iterable[XY], radius: float) -> None:
        self.radius = radius
        self.cells: dict[tuple[int, int], list[XY]] = {}
        for p in points:
            self.cells.setdefault(self._cell(p), []).append(p)

    def _cell(self, p: XY) -> tuple[int, int]:
        return int(math.floor(p[0] / self.radius)), int(math.floor(p[1] / self.radius))

    def has(self, p: XY) -> bool:
        cx, cy = self._cell(p)
        r2 = self.radius * self.radius
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for q in self.cells.get((cx + dx, cy + dy), ()):
                    if (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 <= r2:
                        return True
        return False


#: How close a point must come to ground already covered to count as covering it
#: again, and how far back along the path "already" starts: the path just behind is
#: the same stretch being run, not a return to it.
_REVISIT_M = 30.0
_REVISIT_BEHIND = 5


def _ground(path: Sequence[XY]) -> list[XY]:
    """The ground a densified track covers, each stretch once: laps and the way back
    of an out-and-back add nothing."""
    cells: dict[tuple[int, int], list[tuple[XY, int]]] = {}
    kept: list[XY] = []
    r2 = _REVISIT_M * _REVISIT_M
    for i, p in enumerate(path):
        cx, cy = int(math.floor(p[0] / _REVISIT_M)), int(math.floor(p[1] / _REVISIT_M))
        revisit = any(
            j < i - _REVISIT_BEHIND and (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 <= r2
            for dx in (-1, 0, 1)
            for dy in (-1, 0, 1)
            for q, j in cells.get((cx + dx, cy + dy), ())
        )
        if not revisit:
            kept.append(p)
            cells.setdefault((cx, cy), []).append((p, i))
    return kept


def ground_length(points: Sequence[tuple[float, float]]) -> float:
    """Metres of distinct ground a track covers: one lap of a loop run three times, or
    half an out-and-back."""
    if len(points) < 2:
        return 0.0
    return len(_ground(_densify(points, points[0][0]))) * GROUND_STEP_M


def _frame(lat: float) -> float:
    """The reference latitude two tracks are projected about: the nearest whole degree.

    Both sides of a comparison must share one, because projected x is absolute (metres
    from the meridian); rounding lets every run near a route reuse its projection.
    Within half a degree the scale error is a fraction of a percent.
    """
    return float(round(lat))


@functools.lru_cache(maxsize=1024)
def _route_geometry(points_json: str) -> tuple[float, "_Near", list[XY]]:
    """A stored route shape, densified, as `match_score` needs it. Cached on the shape
    itself, so a regroup measures each route once rather than once per run."""
    pts = [(p[0], p[1]) for p in json.loads(points_json)]
    lat0 = _frame(pts[0][0])
    path = _densify(pts, lat0)
    return lat0, _Near(path, TOLERANCE_M), _ground(path)


def _shares(run_path: Sequence[XY], on_run: "_Near", on_route: "_Near",
            route_ground: Sequence[XY]) -> float:
    if not run_path or not route_ground:
        return 0.0
    run_share = sum(1 for p in run_path if on_route.has(p)) / len(run_path)
    covered = sum(1 for p in route_ground if on_run.has(p)) / len(route_ground)
    return min(run_share, covered)


def match_score(
    run: Sequence[tuple[float, float]],
    route: Sequence[tuple[float, float]],
    tolerance_m: float = TOLERANCE_M,
) -> float:
    """How well a run fits a route, 0..1: the lower of the share of the distance run
    that was on the route's ground, and the share of the route's ground that was run.

    Laps count once per lap in the first and change nothing in the second, so any
    number of laps of a loop scores like one. A run that goes far past the route
    loses on the first; one that covers only part of it loses on the second.
    """
    if len(run) < 2 or len(route) < 2:
        return 0.0
    lat0 = _frame(route[0][0])
    run_path = _densify(run, lat0)
    route_path = _densify(route, lat0)
    return _shares(run_path, _Near(run_path, tolerance_m), _Near(route_path, tolerance_m),
                   _ground(route_path))


class _RunPaths:
    """One run densified once per reference frame, for scoring it against many routes."""

    def __init__(self, points: Sequence[tuple[float, float]]) -> None:
        self.points = points
        self.frames: dict[float, tuple[list[XY], _Near]] = {}

    def score(self, route_points_json: str) -> float:
        lat0, on_route, route_ground = _route_geometry(route_points_json)
        if lat0 not in self.frames:
            path = _densify(self.points, lat0)
            self.frames[lat0] = (path, _Near(path, TOLERANCE_M))
        run_path, on_run = self.frames[lat0]
        return _shares(run_path, on_run, on_route, route_ground)


def similarity(
    a: Sequence[tuple[float, float]],
    b: Sequence[tuple[float, float]],
    tolerance_m: float = TOLERANCE_M,
) -> float:
    """`match_score` both ways round, the lower: for comparing two tracks as equals,
    where neither is the route."""
    if not a or not b:
        return 0.0
    return min(match_score(a, b, tolerance_m), match_score(b, a, tolerance_m))


def first_lap(points: Sequence[tuple[float, float]]) -> list[tuple[float, float]]:
    """One time round: the track up to its first return to where it started, once it
    has covered most of its ground. A loop run three times gives one lap; an
    out-and-back, which only comes back at the end, is its own lap; and so is a track
    that never comes back."""
    if len(points) < 3:
        return list(points)
    need = 0.8 * ground_length(points)
    start = points[0]
    walked = 0.0
    best_i, best_d = None, float("inf")
    for i in range(1, len(points)):
        walked += haversine(points[i - 1][0], points[i - 1][1], points[i][0], points[i][1])
        if walked < need:
            continue
        d = haversine(start[0], start[1], points[i][0], points[i][1])
        if d <= LOOP_TOL_M:
            if d < best_d:
                best_i, best_d = i, d
            continue
        if best_i is not None:
            break  # the closest pass is behind us: cut there
    return list(points[: best_i + 1]) if best_i is not None else list(points)


#: An out-and-back covers its ground twice, so its ground is about half its length;
#: a loop's is all of it. Below this share it is an out-and-back.
OUT_AND_BACK_GROUND_SHARE = 0.7


def route_layout(points: Sequence[tuple[float, float]], is_loop: bool) -> str:
    """'loop', 'out_and_back' or 'one_way', from one lap of the route."""
    if not is_loop:
        return "one_way"
    length = path_length(points)
    if length > 0 and ground_length(points) < OUT_AND_BACK_GROUND_SHARE * length:
        return "out_and_back"
    return "loop"


def shape_points(length_m: float) -> int:
    """How many points a route shape of this length is stored with."""
    return max(RESAMPLE_N, min(SHAPE_MAX_POINTS, int(length_m / SHAPE_SPACING_M) + 1))


def lap_splits(
    rows: Sequence[dict[str, Any]], start: tuple[float, float], lap_m: float
) -> list[dict[str, float]]:
    """Every full lap in one attempt at a loop: when it passed the route's start, and
    how long and how far each time round took.

    A pass is the closest the track came to the start while within `LAP_GATE_M`. The
    first pass need not be the first sample — a run that starts down the road reaches
    the loop first — and laps cut short or stretched by a detour are left out.

    A run that goes round once from somewhere else on the loop never crosses the line
    twice; when it ends where it began, about one lap on, the whole of it is the lap.
    """
    if lap_m <= 0 or len(rows) < 2:
        return []
    dist = _cumulative(rows)
    # Flat-earth metres about the start: exact enough for a 50 m gate, and this loop
    # runs for every sample of every attempt.
    m_lat = math.radians(1.0) * EARTH_R
    m_lon = m_lat * math.cos(math.radians(start[0]))
    gate2 = LAP_GATE_M * LAP_GATE_M
    passes: list[int] = []
    best_i, best_d = None, float("inf")
    for i, r in enumerate(rows):
        dy = (float(r["lat"]) - start[0]) * m_lat
        dx = (float(r["lon"]) - start[1]) * m_lon
        d = dx * dx + dy * dy
        if d <= gate2:
            if d < best_d:
                best_i, best_d = i, d
            continue
        if best_i is not None:
            # Two passes closer together than half a lap are one wobble at the line.
            if not passes or dist[best_i] - dist[passes[-1]] >= 0.5 * lap_m:
                passes.append(best_i)
            best_i, best_d = None, float("inf")
    if best_i is not None and (not passes or dist[best_i] - dist[passes[-1]] >= 0.5 * lap_m):
        passes.append(best_i)

    laps: list[dict[str, float]] = []
    for a, b in zip(passes, passes[1:]):
        metres = dist[b] - dist[a]
        seconds = float(rows[b]["elapsed_s"]) - float(rows[a]["elapsed_s"])
        if seconds <= 0 or not LAP_MIN_SHARE * lap_m <= metres <= LAP_MAX_SHARE * lap_m:
            continue
        laps.append({
            "start_i": a,
            "end_i": b,
            "seconds": round(seconds, 1),
            "distance_m": round(metres, 1),
        })
    if not laps:
        first, last = rows[0], rows[-1]
        metres = dist[-1] - dist[0]
        seconds = float(last["elapsed_s"]) - float(first["elapsed_s"])
        closed = haversine(float(first["lat"]), float(first["lon"]),
                           float(last["lat"]), float(last["lon"])) <= LOOP_TOL_M
        if closed and seconds > 0 and LAP_MIN_SHARE * lap_m <= metres <= LAP_MAX_SHARE * lap_m:
            laps.append({
                "start_i": 0,
                "end_i": len(rows) - 1,
                "seconds": round(seconds, 1),
                "distance_m": round(metres, 1),
            })
    return laps


def lap_start(rows: Sequence[dict[str, Any]], route_points_json: str,
              route_start: tuple[float, float]) -> tuple[float, float]:
    """Where one attempt's laps are timed from: where it started, when that is on the
    loop — a lap is each time back to where you set off — else the route's own start,
    for a run that reached the loop from somewhere else.

    Timing every attempt from the route's start line lost a lap whenever a run began a
    few dozen metres from it (one in six laps on the real history).
    """
    if not rows:
        return route_start
    first = (float(rows[0]["lat"]), float(rows[0]["lon"]))
    lat0, on_route, _ground_pts = _route_geometry(route_points_json)
    return first if on_route.has(_project(first[0], first[1], lat0)) else route_start


def _cumulative(rows: Sequence[dict[str, Any]]) -> list[float]:
    """Distance along an attempt: the device's own where it gave one, else the track's."""
    dist = [r.get("distance_m") for r in rows]
    if all(d is not None for d in dist):
        return [float(d) for d in dist]  # type: ignore[arg-type]
    out = [0.0]
    for i in range(1, len(rows)):
        out.append(out[-1] + haversine(
            float(rows[i - 1]["lat"]), float(rows[i - 1]["lon"]),
            float(rows[i]["lat"]), float(rows[i]["lon"]),
        ))
    return out


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


def lap_rows(store: Store, activity_id: str) -> list[dict[str, Any]]:
    """Just what `lap_splits` reads, for timing laps over many attempts at once."""
    return store.query(
        "SELECT elapsed_s, distance_m, lat, lon FROM activity_samples "
        "WHERE activity_id = ? AND lat IS NOT NULL AND lon IS NOT NULL ORDER BY elapsed_s",
        (activity_id,),
    )


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


_LAYOUT_WORDS = {"loop": "loop", "out_and_back": "out and back", "one_way": "route"}


def _auto_name(distance_m: float, layout: str, number: int) -> str:
    """"1.6 km loop #26": what a route is called until the user names it."""
    return f"{distance_m / 1000.0:.1f} km {_LAYOUT_WORDS.get(layout, 'route')} #{number}"


def _lap_share(gain_m: float | None, lap_m: float, total_m: float) -> float | None:
    """A run's climb, scaled to one lap of it: the lap's share of what was run."""
    if gain_m is None or total_m <= 0:
        return None
    return round(float(gain_m) * min(1.0, lap_m / total_m), 1)


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
    # The nearest sample with an altitude, before and after each index: one pass each
    # way, rather than a search per point.
    before: list[int | None] = []
    last: int | None = None
    for i, a in enumerate(alts):
        if a is not None:
            last = i
        before.append(last)
    after: list[int | None] = [None] * len(alts)
    nxt: int | None = None
    for i in range(len(alts) - 1, -1, -1):
        if alts[i] is not None:
            nxt = i
        after[i] = nxt
    out: list[float | None] = []
    for k in range(n):
        src = int(round(k * (len(alts) - 1) / max(n - 1, 1)))
        lo, hi = before[src], after[src]
        near = lo if hi is None or (lo is not None and src - lo <= hi - src) else hi
        out.append(round(float(alts[near]), 1))  # type: ignore[index, arg-type]
    return out


def _candidate_routes(
    store: Store, activity_type: str, centroid: tuple[float, float]
) -> list[dict[str, Any]]:
    """Cheap pre-filter: same sport, nearby centroid. Distance is not a filter: three
    laps of a loop are three times as far as one and the same route."""
    rows = store.query(
        "SELECT * FROM routes WHERE activity_type = ?", (activity_type,)
    )
    return [
        r for r in rows
        if haversine(centroid[0], centroid[1], r["centroid_lat"], r["centroid_lon"])
        <= CENTROID_TOL_M
    ]


def _lap_of(rows: Sequence[dict[str, Any]]) -> dict[str, Any]:
    """One attempt's first lap (`first_lap`): its points, rows, length and whether it
    ends where it began. Cheap enough to take for every member of a route."""
    pts = [(float(r["lat"]), float(r["lon"])) for r in rows]
    lap = first_lap(pts)
    return {
        "lap": lap,
        "lap_rows": rows[: len(lap)],
        "distance_m": path_length(lap),
        "is_loop": haversine(lap[0][0], lap[0][1], lap[-1][0], lap[-1][1]) <= LOOP_TOL_M,
    }


def _lap_shape(rows: Sequence[dict[str, Any]]) -> dict[str, Any]:
    """A route's geometry from one attempt: its first lap, resampled. The column values
    `routes` stores for it, plus the lap's own points."""
    return _shape_columns(_lap_of(rows))


def _shape_columns(lap_of: dict[str, Any]) -> dict[str, Any]:
    lap, lap_rows, length = lap_of["lap"], lap_of["lap_rows"], lap_of["distance_m"]
    is_loop = lap_of["is_loop"]
    sampled = resample(lap, shape_points(length))
    return {
        "lap": lap,
        "lap_rows": lap_rows,
        "signature": signature(resample(lap)),
        "points": _route_points_json(sampled, lap_rows),
        "distance_m": length,
        "start_lat": lap[0][0], "start_lon": lap[0][1],
        "end_lat": lap[-1][0], "end_lon": lap[-1][1],
        "centroid_lat": sum(p[0] for p in sampled) / len(sampled),
        "centroid_lon": sum(p[1] for p in sampled) / len(sampled),
        "is_loop": int(is_loop),
        "layout": route_layout(lap, is_loop),
    }


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

    centroid = (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))
    activity_type = row["activity_type"]

    run = _RunPaths(pts)
    best_route, best_score = None, 0.0
    for cand in _candidate_routes(store, activity_type, centroid):
        score = run.score(cand["points"])
        if score > best_score:
            best_route, best_score = cand, score

    now = utcnow()
    if best_route is not None and best_score >= threshold:
        route_id = int(best_route["route_id"])
        action = "joined"
    else:
        shape = _lap_shape(rows)
        cur = store.conn.execute(
            """
            INSERT INTO routes (name, activity_type, signature, points, distance_m,
                                elevation_gain_m, start_lat, start_lon, end_lat, end_lon,
                                centroid_lat, centroid_lon, is_loop, pinned,
                                created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
            """,
            (
                "",  # named below, once it has an id
                activity_type,
                shape["signature"],
                shape["points"],
                shape["distance_m"],
                _lap_share(row["elevation_gain_m"], shape["distance_m"], length),
                shape["start_lat"], shape["start_lon"], shape["end_lat"], shape["end_lon"],
                shape["centroid_lat"], shape["centroid_lon"],
                shape["is_loop"],
                now, now,
            ),
        )
        route_id = int(cur.lastrowid)  # type: ignore[arg-type]
        store.conn.execute(
            "UPDATE routes SET name = ? WHERE route_id = ?",
            (_auto_name(shape["distance_m"], shape["layout"], route_id), route_id),
        )
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
    fresh: bool = False,
) -> dict[str, Any]:
    """File every GPS activity (or a given subset) not yet on a route, and rebuild the
    segment efforts of the routes that gained one.

    An activity already filed stays where it is: refiling it against routes whose
    shapes have since moved would shuffle routes on every sync for no new data.

    `fresh` rebuilds instead: it first removes every route the clusterer made and
    nobody has touched — not pinned, no activity filed on it by hand — then files
    every activity again from the tracks. What the user decided stays.
    """
    if fresh:
        store.conn.execute(
            "DELETE FROM routes WHERE pinned = 0 AND route_id NOT IN "
            "(SELECT route_id FROM route_members WHERE assigned = 'manual')"
        )
        store.conn.commit()
    ids = list(activity_ids) if activity_ids is not None else gps_activity_ids(store)
    counts = {"created": 0, "joined": 0, "no_gps": 0, "too_short": 0, "kept_manual": 0}
    touched: set[int] = set()
    filed = {
        r["activity_id"]
        for r in store.query("SELECT activity_id FROM route_members")
    }
    counts["already_filed"] = 0
    for i, aid in enumerate(ids, 1):
        if aid in filed:
            counts["already_filed"] += 1
            continue
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
    """Recompute a route's shape from its members, and its cached segment efforts."""
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
    route = store.conn.execute(
        "SELECT points, pinned FROM routes WHERE route_id = ?", (route_id,)
    ).fetchone()
    current = [(p[0], p[1]) for p in json.loads(route["points"])] if route else []

    # One lap of each member. The shape is the median-length lap among those that
    # match the route as it stands: robust to one run where the GPS wandered, to a
    # run that started down the road, and always a lap someone actually ran.
    laps: list[dict[str, Any]] = []
    for aid in members:
        rows = track_rows(store, aid)
        if len(rows) >= MIN_POINTS:
            laps.append(_lap_of(rows))
    if not laps:
        return
    clean = [lap for lap in laps if current and match_score(lap["lap"], current) >= MATCH_THRESHOLD]
    pool = sorted(clean or laps, key=lambda lap: lap["distance_m"])
    shape = _shape_columns(pool[len(pool) // 2])

    store.conn.execute(
        """
        UPDATE routes SET signature = ?, points = ?, distance_m = ?, start_lat = ?,
               start_lon = ?, end_lat = ?, end_lon = ?, centroid_lat = ?,
               centroid_lon = ?, is_loop = ?, updated_at = ?
        WHERE route_id = ?
        """,
        (
            shape["signature"], shape["points"], shape["distance_m"],
            shape["start_lat"], shape["start_lon"], shape["end_lat"], shape["end_lon"],
            shape["centroid_lat"], shape["centroid_lon"], shape["is_loop"],
            utcnow(), route_id,
        ),
    )
    if route and not route["pinned"]:
        # Its own name is a description of its shape, which may just have changed.
        store.conn.execute(
            "UPDATE routes SET name = ? WHERE route_id = ?",
            (_auto_name(shape["distance_m"], shape["layout"], route_id), route_id),
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
    covers the same stretch of road regardless of how fast that day went. On a loop
    each lap is walked from the start line and the laps of one attempt averaged, so
    segment k is the same stretch on lap 1 and lap 5; segments past the end of the
    route's one lap (a run that carried on) are not the route and are dropped.
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

    route_m = float(route["distance_m"])
    start = (float(route["start_lat"]), float(route["start_lon"]))
    written = 0
    for aid in members:
        rows = track_rows(store, aid)
        if len(rows) < 2:
            continue
        laps = lap_splits(rows, start, route_m) if route["is_loop"] else []
        if laps:
            efforts = _mean_efforts([
                _segment_activity(_from_start(rows[lap["start_i"]: lap["end_i"] + 1]), seg_m)
                for lap in laps
            ])
        else:
            efforts = _segment_activity(rows, seg_m)
        for eff in efforts:
            if eff["end_m"] > route_m + seg_m / 2:
                continue
            store.upsert(
                "route_segment_efforts",
                ["route_id", "activity_id", "seg_index"],
                {"route_id": route_id, "activity_id": aid, **eff},
            )
            written += 1
    store.conn.commit()
    return written


def _from_start(rows: Sequence[dict[str, Any]]) -> list[dict[str, Any]]:
    """A slice of an attempt with its distance counted from the slice's first sample."""
    if not rows or rows[0].get("distance_m") is None:
        return list(rows)
    d0 = float(rows[0]["distance_m"])
    return [
        {**r, "distance_m": None if r.get("distance_m") is None else float(r["distance_m"]) - d0}
        for r in rows
    ]


def _mean_efforts(laps: Sequence[Sequence[dict[str, Any]]]) -> list[dict[str, Any]]:
    """One attempt's segments as the mean over its laps, segment by segment."""
    by_index: dict[int, list[dict[str, Any]]] = {}
    for lap in laps:
        for eff in lap:
            by_index.setdefault(int(eff["seg_index"]), []).append(eff)
    out = []
    for k in sorted(by_index):
        group = by_index[k]
        row = {"seg_index": k, "start_m": group[0]["start_m"], "end_m": group[0]["end_m"]}
        for field, digits in (("seconds", 2), ("speed_mps", 4), ("avg_hr", 1),
                              ("avg_cadence_spm", 1), ("gradient_pct", 2)):
            values = [float(e[field]) for e in group if e.get(field) is not None]
            row[field] = round(sum(values) / len(values), digits) if values else None
        out.append(row)
    return out


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
        SELECT r.route_id, r.name, r.activity_type, r.distance_m, r.is_loop, r.pinned, r.points,
               r.start_lat AS lap_start_lat, r.start_lon AS lap_start_lon,
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
        laps = lap_times(store, {**r, "start_lat": r["lap_start_lat"], "start_lon": r["lap_start_lon"]})
        r["distance_km"] = round(float(r["distance_m"] or 0) / 1000.0, 2)
        r["is_loop"] = bool(r["is_loop"])
        r["layout"] = route_layout(
            [(p[0], p[1]) for p in json.loads(r.pop("points"))], r["is_loop"]
        )
        r["pinned"] = bool(r["pinned"])
        r["best_lap_s"] = min(laps) if laps else None
        r["median_lap_s"] = _median(laps, digits=1)
        del r["lap_start_lat"], r["lap_start_lon"]
    return rows


def lap_times(store: Store, route: dict[str, Any], counted_only: bool = True) -> list[float]:
    """Every lap timed round a loop route, over the attempts that count; empty for a
    route that is not a loop. `route` needs its row's points, distance, start and
    is_loop."""
    points = [(p[0], p[1]) for p in json.loads(route["points"])]
    if route_layout(points, bool(route["is_loop"])) != "loop":
        return []
    excluded = "AND COALESCE(v.excluded_from_stats, 0) = 0" if counted_only else ""
    members = store.query(
        "SELECT m.activity_id FROM route_members m "
        "JOIN v_activities v ON v.activity_id = m.activity_id "
        f"WHERE m.route_id = ? {excluded}",
        (route["route_id"],),
    )
    start = (float(route["start_lat"]), float(route["start_lon"]))
    lap_m = float(route["distance_m"])
    times: list[float] = []
    for m in members:
        rows = lap_rows(store, m["activity_id"])
        own = lap_start(rows, route["points"], start)
        times.extend(lap["seconds"] for lap in lap_splits(rows, own, lap_m))
    return times


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
    points = json.loads(route["points"])
    layout = route_layout([(p[0], p[1]) for p in points], bool(route["is_loop"]))
    # Laps, for a loop: every time round, timed from the start line.
    lap_m = float(route["distance_m"]) if layout == "loop" else None
    start = (float(route["start_lat"]), float(route["start_lon"]))
    for a in attempts:
        rows = lap_rows(store, a["activity_id"]) if lap_m else []
        laps = lap_splits(rows, lap_start(rows, route["points"], start), lap_m) if lap_m else []
        a["laps"] = len(laps) if lap_m else None
        a["lap_times_s"] = [lap["seconds"] for lap in laps]
        a["best_lap_s"] = min(a["lap_times_s"]) if laps else None

    counted = [a for a in attempts if not a.get("excluded_from_stats")]
    times = [float(a["moving_time_s"]) for a in counted if a.get("moving_time_s")]
    lap_times = [t for a in counted for t in a["lap_times_s"]]
    best_lap = min(
        (a for a in counted if a["best_lap_s"] is not None),
        key=lambda a: a["best_lap_s"],
        default=None,
    )
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
            "points": points,
            "distance_km": round(float(route["distance_m"] or 0) / 1000.0, 2),
            "is_loop": bool(route["is_loop"]),
            "layout": layout,
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
            "lap_m": round(lap_m, 1) if lap_m else None,
            "laps": len(lap_times),
            "best_lap_s": best_lap["best_lap_s"] if best_lap else None,
            "best_lap_activity_id": best_lap["activity_id"] if best_lap else None,
            "best_lap_day": best_lap["day"] if best_lap else None,
            "median_lap_s": _median(lap_times, digits=1),
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
