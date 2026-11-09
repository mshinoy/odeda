"""Recording gaps: where a watch paused and resumed somewhere else, and a guess at the
path travelled in between.

A step between two GPS samples is a *gap* when at least `GAP_MIN_SECONDS` passed, the
points are at least `GAP_MIN_METRES` apart, and the device's own recorded distance moved
by less than `GAP_RECORDED_SHARE` of that straight line. A tunnel (signal lost, distance
still counted) is not one, and neither is a short pause. The line across a gap was never
ridden, so it is not drawn as if it were.

**The estimate.** What was ridden in a gap is not in the file, but the rider has usually
been that way before. `estimate_fill` looks through the rest of the rider's own history
for activities of the same type that passed near both ends of the gap, in the same
direction, and takes the path between them, the shortest if there are several. The speed
is that path's length over the time the gap took, so it is an average and says nothing
about the pace within it. Nothing here changes the activity: it is a guess, kept apart,
and always labelled as one.

No outside service is involved. If nothing in the history passed both ends, there is no
estimate and the gap stays a gap.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from typing import Any

#: At least this long between two GPS samples...
GAP_MIN_SECONDS = 60.0
#: ...with the points at least this far apart...
GAP_MIN_METRES = 250.0
#: ...and the device's recorded distance moving by less than this share of that line.
GAP_RECORDED_SHARE = 0.5

#: How close another activity must pass to a gap's end to count as passing through it.
NEAR_METRES = 100.0
#: Degrees of latitude and longitude for a quick box test before the exact distance.
_BOX_DEGREES = 0.0012
#: The fastest a path across a gap may be covered, by activity kind, in m/s. A path that
#: would need more than this is not what happened in the time the gap took.
MAX_SPEED_MPS = {"foot": 8.0, "wheels": 25.0}

LatLon = tuple[float, float]
#: (elapsed seconds, recorded distance in metres or None, latitude, longitude)
Sample = tuple[float, float | None, float, float]


def metres_between(a: LatLon, b: LatLon) -> float:
    r = 6371000.0
    p1, p2 = math.radians(a[0]), math.radians(b[0])
    dp, dl = p2 - p1, math.radians(b[1] - a[1])
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def is_recording_gap(before: Sample, after: Sample) -> bool:
    """Whether the step between two consecutive GPS samples crossed a recording gap."""
    seconds = after[0] - before[0]
    if seconds < GAP_MIN_SECONDS:
        return False
    straight = metres_between((before[2], before[3]), (after[2], after[3]))
    if straight < GAP_MIN_METRES:
        return False
    if before[1] is None or after[1] is None:
        # No recorded distance to compare with: a long pause and a long way is enough.
        return True
    return (after[1] - before[1]) < GAP_RECORDED_SHARE * straight


def split_at_gaps(samples: Sequence[Sample]) -> list[list[LatLon]]:
    """The track as the pieces that were actually recorded, in order."""
    pieces: list[list[LatLon]] = []
    current: list[LatLon] = []
    for i, sample in enumerate(samples):
        if i > 0 and is_recording_gap(samples[i - 1], sample):
            pieces.append(current)
            current = []
        current.append((sample[2], sample[3]))
    pieces.append(current)
    return [piece for piece in pieces if len(piece) >= 2]


def find_gaps(samples: Sequence[Sample]) -> list[dict[str, Any]]:
    """Every gap in a track, in order, with the two samples either side of it."""
    gaps = []
    for i in range(1, len(samples)):
        before, after = samples[i - 1], samples[i]
        if not is_recording_gap(before, after):
            continue
        gaps.append(
            {
                "before": {"elapsed_s": before[0], "lat": before[2], "lon": before[3]},
                "after": {"elapsed_s": after[0], "lat": after[2], "lon": after[3]},
                "seconds": after[0] - before[0],
                "straight_m": metres_between((before[2], before[3]), (after[2], after[3])),
            }
        )
    return gaps


# ---------------------------------------------------------------- the estimate


def _kind(activity_type: str) -> str:
    """`foot` or `wheels`: what limits how fast the path could have been covered."""
    t = activity_type.lower()
    if any(word in t for word in ("cycl", "bik", "ride", "e_bike")):
        return "wheels"
    return "foot"


def _path_between(
    track: Sequence[LatLon], a: LatLon, b: LatLon
) -> tuple[list[LatLon], float] | None:
    """The shortest stretch of `track` that runs from near `a` to near `b`, in that
    order, or None. Order matters: the same road ridden the other way is the other
    carriageway, and the gap was ridden from `a` to `b`."""
    if len(track) < 2:
        return None
    cum = [0.0]
    for p, q in zip(track, track[1:]):
        cum.append(cum[-1] + metres_between(p, q))
    near_a = [i for i, p in enumerate(track) if metres_between(a, p) <= NEAR_METRES]
    near_b = [i for i, p in enumerate(track) if metres_between(b, p) <= NEAR_METRES]
    best: tuple[float, int, int] | None = None
    for i in near_a:
        for j in near_b:
            if j <= i:
                continue
            length = cum[j] - cum[i]
            if best is None or length < best[0]:
                best = (length, i, j)
    if best is None:
        return None
    _, i, j = best
    path = [a, *track[i : j + 1], b]
    length = sum(metres_between(p, q) for p, q in zip(path, path[1:]))
    return path, length


def estimate_fill(
    store, activity_id: str, activity_type: str, gap: dict[str, Any]
) -> dict[str, Any] | None:
    """A guess at the path across `gap`, from the rest of the rider's own history."""
    a = (gap["before"]["lat"], gap["before"]["lon"])
    b = (gap["after"]["lat"], gap["after"]["lon"])
    seconds = float(gap["seconds"])
    straight = float(gap["straight_m"])
    limit = MAX_SPEED_MPS[_kind(activity_type)]

    def box(p: LatLon) -> tuple[float, float, float, float]:
        return (p[0] - _BOX_DEGREES, p[0] + _BOX_DEGREES, p[1] - _BOX_DEGREES, p[1] + _BOX_DEGREES)

    def near(p: LatLon) -> set[str]:
        lo_la, hi_la, lo_lo, hi_lo = box(p)
        return {
            r[0]
            for r in store.conn.execute(
                "SELECT DISTINCT s.activity_id FROM activity_samples s "
                "JOIN v_activities_included v ON v.activity_id = s.activity_id "
                "WHERE s.lat BETWEEN ? AND ? AND s.lon BETWEEN ? AND ? "
                "AND v.activity_type = ? AND s.activity_id != ?",
                (lo_la, hi_la, lo_lo, hi_lo, activity_type, activity_id),
            )
        }

    candidates = sorted(near(a) & near(b))
    best: dict[str, Any] | None = None
    for other in candidates:
        track = [
            (la, lo)
            for la, lo in store.conn.execute(
                "SELECT lat, lon FROM activity_samples WHERE activity_id = ? "
                "AND lat IS NOT NULL AND lon IS NOT NULL ORDER BY elapsed_s",
                (other,),
            )
        ]
        found = _path_between(track, a, b)
        if found is None:
            continue
        path, length = found
        # Not shorter than the straight line, and not faster than anyone could go.
        if length < straight * 0.95 or length / seconds > limit:
            continue
        if best is None or length < best["length_m"]:
            best = {"path": path, "length_m": length, "source_activity_id": other}
    if best is None:
        return None
    row = store.conn.execute(
        "SELECT day, activity_name FROM v_activities WHERE activity_id = ?",
        (best["source_activity_id"],),
    ).fetchone()
    return {
        **best,
        "avg_speed_mps": best["length_m"] / seconds,
        "source_day": row[0] if row else None,
        "source_name": row[1] if row else None,
    }


#: Gaps worked out already, by database and activity, with the GPS sample count they came
#: from. A track only changes when a sync rewrites its samples, which changes the count.
_gap_cache: dict[tuple[str, str], tuple[int, list[dict[str, Any]]]] = {}


def activity_gaps(store, activity_id: str) -> list[dict[str, Any]]:
    """Every recording gap in an activity, each with an estimate of the path if the rest
    of the rider's history has one."""
    row = store.conn.execute(
        "SELECT activity_type FROM v_activities WHERE activity_id = ?", (activity_id,)
    ).fetchone()
    if row is None:
        return []
    samples: list[Sample] = [
        (e, d, la, lo)
        for e, d, la, lo in store.conn.execute(
            "SELECT elapsed_s, distance_m, lat, lon FROM activity_samples "
            "WHERE activity_id = ? AND lat IS NOT NULL AND lon IS NOT NULL "
            "ORDER BY elapsed_s",
            (activity_id,),
        )
    ]
    db = str(store.settings.db_path)
    cached = _gap_cache.get((db, activity_id))
    if cached is not None and cached[0] == len(samples):
        return cached[1]
    gaps = find_gaps(samples)
    for gap in gaps:
        gap["estimate"] = estimate_fill(store, activity_id, str(row[0]), gap)
    _gap_cache[(db, activity_id)] = (len(samples), gaps)
    return gaps
