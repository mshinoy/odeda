"""What the activity list's cards draw, beyond the row itself.

A card shows a picture next to its numbers: the route on a static map, or, without
GPS, the HR zones or a gym session's exercises. Each is read here for a whole page of
rows at once, one query per kind, so a page of 50 costs a handful of queries, not 200.

The routes are not in the list response. Simplifying a page of them the first time
takes a few hundred milliseconds, and the cards should not wait for it: the list says
only which activities have GPS (one indexed count), and the page asks for the routes
separately (`GET /api/activities/previews`), drawing the cards meanwhile.

The route goes out as a Google encoded polyline (precision 5), simplified to at most
`MAX_POINTS` points. That is the format Mapbox's Static Images API takes in its URL,
whose 8 KB limit is why the track is simplified at all: 150 points encode to about
1 KB, and at a card's size nothing finer can be seen.
"""

from __future__ import annotations

import json
import math
from collections import defaultdict
from collections.abc import Sequence
from typing import Any

from ..db.store import Store
from ..edits import exercises as relabels_mod
from . import gym as gym_mod

#: The most points a card's route keeps.
MAX_POINTS = 150

#: Douglas–Peucker tolerance as a fraction of the track's bounding-box diagonal:
#: half a percent is under a pixel on a 240 px card.
TOLERANCE = 0.005

LatLon = tuple[float, float]


# ---------------------------------------------------------------- the route


def simplify(points: Sequence[LatLon], max_points: int = MAX_POINTS) -> list[LatLon]:
    """The track with the points a small map cannot show taken out.

    Douglas–Peucker on a local equirectangular projection, which is exact enough over
    the few kilometres of one activity. If that still leaves more than `max_points`
    (a long, winding ride), the survivors are thinned evenly. The first and last
    points are always kept, so the route starts and ends where it did.
    """
    if len(points) <= 2:
        return list(points)
    xy = _project(points)
    keep = _douglas_peucker(xy, TOLERANCE * _diagonal(xy))
    kept = [points[i] for i in keep]
    if len(kept) <= max_points:
        return kept
    step = (len(kept) - 1) / (max_points - 1)
    return [kept[round(i * step)] for i in range(max_points)]


def _project(points: Sequence[LatLon]) -> list[tuple[float, float]]:
    mid_lat = math.radians(sum(lat for lat, _ in points) / len(points))
    scale = math.cos(mid_lat)
    return [(lon * scale, lat) for lat, lon in points]


def _diagonal(xy: Sequence[tuple[float, float]]) -> float:
    xs = [x for x, _ in xy]
    ys = [y for _, y in xy]
    return math.hypot(max(xs) - min(xs), max(ys) - min(ys))


def _douglas_peucker(xy: Sequence[tuple[float, float]], tolerance: float) -> list[int]:
    """Indices of the points to keep, in order. Iterative, so a long track cannot run
    out of recursion depth. Distances stay squared and the segment maths is inline:
    this loop is most of what a cold page of the list costs."""
    keep = {0, len(xy) - 1}
    stack = [(0, len(xy) - 1)]
    limit = tolerance * tolerance
    while stack:
        first, last = stack.pop()
        ax, ay = xy[first]
        dx, dy = xy[last][0] - ax, xy[last][1] - ay
        length_sq = dx * dx + dy * dy
        worst, worst_at = limit, -1
        for i in range(first + 1, last):
            px, py = xy[i][0] - ax, xy[i][1] - ay
            t = 0.0 if length_sq == 0 else max(0.0, min(1.0, (px * dx + py * dy) / length_sq))
            ex, ey = px - t * dx, py - t * dy
            d = ex * ex + ey * ey
            if d > worst:
                worst, worst_at = d, i
        if worst_at != -1:
            keep.add(worst_at)
            stack.append((first, worst_at))
            stack.append((worst_at, last))
    return sorted(keep)


def encode_polyline(points: Sequence[LatLon]) -> str:
    """Google's encoded polyline format, precision 5 (what Mapbox's `path` overlay reads)."""
    out: list[str] = []
    prev_lat = prev_lon = 0
    for lat, lon in points:
        lat_e5, lon_e5 = round(lat * 1e5), round(lon * 1e5)
        out.append(_encode_value(lat_e5 - prev_lat))
        out.append(_encode_value(lon_e5 - prev_lon))
        prev_lat, prev_lon = lat_e5, lon_e5
    return "".join(out)


def _encode_value(value: int) -> str:
    value = ~(value << 1) if value < 0 else value << 1
    chunks: list[str] = []
    while value >= 0x20:
        chunks.append(chr((0x20 | (value & 0x1F)) + 63))
        value >>= 5
    chunks.append(chr(value + 63))
    return "".join(chunks)


# ---------------------------------------------------------------- one page of rows


def with_card_extras(st: Store, rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """`rows` with `has_gps`, `hr_zones` and `exercises` added to each."""
    ids = [r["activity_id"] for r in rows]
    if not ids:
        return rows
    counts = _gps_counts(st, ids)
    zones = _hr_zones(st, ids)
    exercises = _exercises(st, [r["activity_id"] for r in rows if r.get("total_sets") is not None])
    return [
        {
            **r,
            "has_gps": counts.get(r["activity_id"], 0) >= 2,
            "hr_zones": zones.get(r["activity_id"], []),
            "exercises": exercises.get(r["activity_id"], []),
        }
        for r in rows
    ]


def _placeholders(ids: Sequence[str]) -> str:
    return ",".join("?" * len(ids))


#: Encoded routes already worked out, by database and activity, with the GPS point
#: count they were made from. A track only changes when a sync rewrites its samples,
#: and that changes the count, so the count is enough to tell a stale entry. One entry
#: is about half a kilobyte; even a few thousand activities stay small.
_route_cache: dict[tuple[str, str], tuple[int, str | None]] = {}


def _gps_counts(st: Store, ids: Sequence[str]) -> dict[str, int]:
    """GPS points per activity; an activity with none is absent."""
    return dict(
        st.conn.execute(
            "SELECT activity_id, COUNT(*) FROM activity_samples "
            f"WHERE activity_id IN ({_placeholders(ids)}) AND lat IS NOT NULL "
            "GROUP BY activity_id",
            list(ids),
        ).fetchall()
    )


def polylines(st: Store, ids: Sequence[str]) -> dict[str, str]:
    """The encoded route of each of `ids` that has GPS; the others are absent."""
    if not ids:
        return {}
    counts = _gps_counts(st, ids)
    db = str(st.settings.db_path)
    stale = [i for i, n in counts.items() if _route_cache.get((db, i), (None,))[0] != n]
    if stale:
        tracks: dict[str, list[LatLon]] = defaultdict(list)
        for activity_id, lat, lon in st.conn.execute(
            "SELECT activity_id, lat, lon FROM activity_samples "
            f"WHERE activity_id IN ({_placeholders(stale)}) AND lat IS NOT NULL "
            "AND lon IS NOT NULL ORDER BY activity_id, elapsed_s",
            stale,
        ):
            tracks[activity_id].append((lat, lon))
        for activity_id in stale:
            track = tracks.get(activity_id, [])
            encoded = encode_polyline(simplify(track)) if len(track) >= 2 else None
            _route_cache[(db, activity_id)] = (counts[activity_id], encoded)
    return {
        i: encoded
        for i in counts
        if (encoded := _route_cache[(db, i)][1]) is not None
    }


def _hr_zones(st: Store, ids: Sequence[str]) -> dict[str, list[dict[str, Any]]]:
    out: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in st.query(
        "SELECT activity_id, zone, seconds FROM activity_hr_zones "
        f"WHERE activity_id IN ({_placeholders(ids)}) ORDER BY activity_id, zone",
        list(ids),
    ):
        out[row["activity_id"]].append({"zone": row["zone"], "seconds": row["seconds"]})
    return out


def _exercises(st: Store, ids: Sequence[str]) -> dict[str, list[dict[str, Any]]]:
    if not ids:
        return {}
    relabels = relabels_mod.relabels_for(st, ids)
    out: dict[str, list[dict[str, Any]]] = {}
    for row in st.query(
        "SELECT v_activities.activity_id, raw.payload FROM v_activities "
        "LEFT JOIN raw_documents raw ON raw.id = v_activities.raw_id "
        f"WHERE v_activities.activity_id IN ({_placeholders(ids)})",
        list(ids),
    ):
        payload = json.loads(row["payload"]) if row["payload"] else None
        session = gym_mod.exercises_from_payload(payload, relabels.get(row["activity_id"]))
        out[row["activity_id"]] = session["exercises"]
    return out
