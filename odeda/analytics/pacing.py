"""A race-day pacing plan: per-kilometre splits for a target time, with the course's turns.

The splits are for the official race distance and add up to the target exactly. Three
things shape them, and all three are rules of thumb, said as such on the page:

* **A gentle start.** The first kilometre is `START_SLOWER` slower: the crowd, and legs
  that have not warmed up. The rest is spread evenly, so the plan is not a negative split
  in disguise. Choose `negative` for a second half `NEGATIVE_SPLIT` faster than the first.
* **Turns cost time.** Each turnaround or sharp turn on the course costs `TURN_COST_S` of
  slowing and getting going again, added to the kilometre it falls in.
* **No hills.** Without elevation in the course file the plan is flat, which is right for
  Doha and wrong for most places. It says so.

The course is optional. With a GPX in `<data dir>/courses/<race date>.gpx` the turns are
found on it (a heading change over about 100 m) and marked on the kilometre they fall in.
Without one the plan is even splits and says that no course was found. The file is the
owner's, kept in the data directory, because a course belongs to a race and not to the app.
"""

from __future__ import annotations

import math
import xml.etree.ElementTree as ET
from collections.abc import Sequence
from datetime import date
from pathlib import Path
from typing import Any

from . import forecast as forecast_mod
from .gaps import metres_between

LatLon = tuple[float, float]

#: The first kilometre, slower by this share than an even plan would run it.
START_SLOWER = 0.02
#: With `negative`, the first half this much slower and the second this much faster.
NEGATIVE_SPLIT = 0.01
#: Seconds a turnaround or sharp turn costs: slowing into it and getting going again.
TURN_COST_S = 5.0

#: Spacing the course is resampled to before its turns are looked for.
RESAMPLE_M = 20.0
#: Heading is compared this many samples either side of a point: about 100 m.
TURN_WINDOW = 5
#: A heading change at least this large over that window is a turn...
TURN_MIN_DEGREES = 60.0
#: ...and at least this large a turnaround (a U-turn or the loop of one).
TURNAROUND_MIN_DEGREES = 130.0
#: Turns closer together than this are one event.
TURN_MERGE_M = 400.0
#: Turns this close to the start or the finish are the start and the finish.
TURN_EDGE_M = 200.0

STRATEGIES = ("even", "negative")


# ---------------------------------------------------------------- the course


def read_gpx(path: Path) -> list[LatLon]:
    """The track points of a GPX file, in order. Raises ValueError for a file with none."""
    root = ET.parse(path).getroot()
    points = [
        (float(el.attrib["lat"]), float(el.attrib["lon"]))
        for el in root.iter()
        if el.tag.rsplit("}", 1)[-1] == "trkpt"
    ]
    if len(points) < 2:
        raise ValueError(f"{path.name} has no track")
    return points


def course_path(data_dir: Path, race_day: str) -> Path:
    """Where a race's course lives: `<data dir>/courses/<race date>.gpx`."""
    return data_dir / "courses" / f"{race_day}.gpx"


def _resample(points: Sequence[LatLon], step_m: float) -> list[LatLon]:
    cum = [0.0]
    for a, b in zip(points, points[1:]):
        cum.append(cum[-1] + metres_between(a, b))
    out: list[LatLon] = []
    j = 0
    at = 0.0
    while at <= cum[-1]:
        while j + 1 < len(cum) - 1 and cum[j + 1] < at:
            j += 1
        span = cum[j + 1] - cum[j]
        t = 0.0 if span == 0 else (at - cum[j]) / span
        out.append(
            (
                points[j][0] + (points[j + 1][0] - points[j][0]) * t,
                points[j][1] + (points[j + 1][1] - points[j][1]) * t,
            )
        )
        at += step_m
    return out


def _bearing(a: LatLon, b: LatLon) -> float:
    p1, p2 = math.radians(a[0]), math.radians(b[0])
    dl = math.radians(b[1] - a[1])
    y = math.sin(dl) * math.cos(p2)
    x = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    return math.degrees(math.atan2(y, x))


def _turn(before: float, after: float) -> float:
    """The change of heading, in degrees, between -180 and 180."""
    return (after - before + 180.0) % 360.0 - 180.0


def course_profile(points: Sequence[LatLon]) -> dict[str, Any]:
    """The length of a course and where it turns, in metres from the start."""
    track = _resample(points, RESAMPLE_M)
    length = metres_between(points[0], points[-1]) if len(points) < 2 else sum(
        metres_between(a, b) for a, b in zip(points, points[1:])
    )
    k = TURN_WINDOW
    candidates: list[tuple[float, float]] = []  # (metres from start, degrees)
    for i in range(k, len(track) - k):
        change = abs(_turn(_bearing(track[i - k], track[i]), _bearing(track[i], track[i + k])))
        at = i * RESAMPLE_M
        if change >= TURN_MIN_DEGREES and TURN_EDGE_M <= at <= length - TURN_EDGE_M:
            candidates.append((at, change))

    clusters: list[list[tuple[float, float]]] = []
    for item in candidates:
        if clusters and item[0] - clusters[-1][-1][0] <= TURN_MERGE_M:
            clusters[-1].append(item)
        else:
            clusters.append([item])
    turns = []
    for cluster in clusters:
        at, degrees = max(cluster, key=lambda c: c[1])
        turns.append(
            {
                "at_m": round(at),
                "kind": "turnaround" if degrees >= TURNAROUND_MIN_DEGREES else "turn",
            }
        )
    return {"length_m": round(length), "turns": turns}


# ---------------------------------------------------------------- the splits


def split_plan(
    target_s: float,
    distance_m: float,
    turns_m: Sequence[float] = (),
    strategy: str = "even",
) -> list[dict[str, Any]]:
    """Per-kilometre splits that add up to `target_s` over `distance_m`.

    `turns_m` are distances from the start, on the race's own distance. The last row is
    the partial kilometre to the finish.
    """
    if strategy not in STRATEGIES:
        raise ValueError(f"strategy must be one of {STRATEGIES}")
    if target_s <= 0 or distance_m <= 0:
        raise ValueError("target and distance must be positive")

    full = int(distance_m // 1000)
    lengths = [1000.0] * full
    if distance_m - full * 1000 > 0.5:
        lengths.append(distance_m - full * 1000)

    extras = [0.0] * len(lengths)
    for at in turns_m:
        extras[min(int(at // 1000), len(lengths) - 1)] += TURN_COST_S

    weights = []
    start = 0.0
    for i, length in enumerate(lengths):
        weight = 1.0 + (START_SLOWER if i == 0 else 0.0)
        middle = start + length / 2
        if strategy == "negative":
            weight *= (1.0 + NEGATIVE_SPLIT) if middle < distance_m / 2 else (1.0 - NEGATIVE_SPLIT)
        weights.append(weight)
        start += length

    moving = max(target_s - sum(extras), target_s * 0.5)
    total_weight = sum(length * w for length, w in zip(lengths, weights))
    times = [moving * length * w / total_weight + extra for length, w, extra in zip(lengths, weights, extras)]
    times = [round(t, 1) for t in times]
    times[-1] = round(times[-1] + (target_s - sum(times)), 1)

    rows = []
    cum = 0.0
    done = 0.0
    for i, (length, seconds) in enumerate(zip(lengths, times)):
        cum += seconds
        done += length
        rows.append(
            {
                "km": i + 1,
                "distance_m": round(length, 1),
                "split_s": seconds,
                "cum_s": round(cum, 1),
                "pace_s_per_km": round(seconds / (length / 1000.0), 1),
                "end_m": round(done, 1),
            }
        )
    return rows


# ---------------------------------------------------------------- the whole plan


def compute_pacing(
    store,
    settings,
    target_s: float | None = None,
    strategy: str = "even",
    today: date | None = None,
) -> dict[str, Any]:
    """The pacing plan for the goal race, from a target time (the likely finish if none)."""
    today = today or date.today()
    forecast = forecast_mod.compute_forecast(store, today)
    race = forecast["race"]
    empty = {
        "race": race, "target_s": None, "strategy": strategy, "presets": [],
        "course": {"source": "none", "length_m": None, "turns": []}, "splits": [],
    }
    if race is None or not race.get("distance_m"):
        return empty

    time = forecast["time"]
    presets = []
    if time is not None:
        adj = time["adjusted"]
        presets = [
            {"label": "Fast", "target_s": round(adj["fast"])},
            {"label": "Likely", "target_s": round(adj["central"])},
            {"label": "Slow", "target_s": round(adj["slow"])},
        ]
    target = target_s if target_s is not None else (presets[1]["target_s"] if presets else None)
    if target is None:
        return {**empty, "presets": presets}

    distance = float(race["distance_m"])
    course = {"source": "none", "length_m": None, "turns": []}
    turns_m: list[float] = []
    path = course_path(settings.data_dir, race["date"])
    if path.is_file():
        try:
            profile = course_profile(read_gpx(path))
        except (ValueError, ET.ParseError):
            profile = None
        if profile is not None:
            scale = distance / profile["length_m"] if profile["length_m"] else 1.0
            turns_m = [t["at_m"] * scale for t in profile["turns"]]
            course = {
                "source": "gpx",
                "length_m": profile["length_m"],
                "turns": [
                    {"km": round(m / 1000.0, 1), "kind": t["kind"]}
                    for m, t in zip(turns_m, profile["turns"])
                ],
            }

    return {
        "race": race,
        "target_s": float(target),
        "strategy": strategy,
        "presets": presets,
        "course": course,
        "splits": split_plan(float(target), distance, turns_m, strategy),
    }
