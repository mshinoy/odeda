"""Route geometry for the seeder: real tracks, so the demo map looks like a real person's.

The shapes are recorded tracks (see `real_routes.json`), laid under synthetic runs.
Only the movement along them is invented: pace, heart rate and the day each run
happened. Every run on a route follows the same line and the same hills, which is
what makes "you always slow down at 4.2 km" a real, checkable signal rather than
noise, and what route clustering needs in order to be demonstrated at all.
"""

from __future__ import annotations

import json
import math
import random
from pathlib import Path
from dataclasses import dataclass, field
from typing import Sequence

#: Metres per degree of latitude. Good to ~0.1 % anywhere, which is far below the
#: GPS noise we deliberately add.
M_PER_DEG_LAT = 111_320.0


@dataclass(frozen=True)
class Hill:
    """A bump in the elevation profile, at a fixed place along the route.

    `at` is a fraction of route distance, `height_m` the rise, `width` the fraction
    of the route it is spread over. Gaussian, so it has a real gradient either side.
    """

    at: float
    height_m: float
    width: float = 0.06


@dataclass(frozen=True)
class RouteTemplate:
    key: str
    name: str
    sport: str
    anchor: tuple[float, float]
    nominal_m: float
    shape: str = "loop"          # loop | out_back
    lobes: int = 3
    phase: float = 0.0
    base_alt_m: float = 8.0
    hills: tuple[Hill, ...] = ()
    #: Runs shorter/longer than this fraction of `nominal_m` will not pick this route.
    tolerance: float = 0.18


@dataclass
class Route:
    """A built route: a dense polyline with elevation and cumulative distance."""

    template: RouteTemplate
    lats: list[float]
    lons: list[float]
    alts: list[float]
    cum: list[float] = field(default_factory=list)

    @property
    def total_m(self) -> float:
        return self.cum[-1] if self.cum else 0.0

    @property
    def name(self) -> str:
        return self.template.name

    def position_at(self, distance_m: float) -> tuple[float, float, float]:
        """(lat, lon, altitude) at a distance along the route, linearly interpolated."""
        d = min(max(distance_m, 0.0), self.total_m)
        lo, hi = 0, len(self.cum) - 1
        while lo < hi:
            mid = (lo + hi) // 2
            if self.cum[mid] < d:
                lo = mid + 1
            else:
                hi = mid
        i = max(1, lo)
        span = self.cum[i] - self.cum[i - 1]
        t = 0.0 if span <= 0 else (d - self.cum[i - 1]) / span
        return (
            self.lats[i - 1] + t * (self.lats[i] - self.lats[i - 1]),
            self.lons[i - 1] + t * (self.lons[i] - self.lons[i - 1]),
            self.alts[i - 1] + t * (self.alts[i] - self.alts[i - 1]),
        )

    def gradient_at(self, distance_m: float, window_m: float = 100.0) -> float:
        """Gradient in percent, measured over a window centred on `distance_m`."""
        a = self.position_at(max(0.0, distance_m - window_m / 2))
        b = self.position_at(min(self.total_m, distance_m + window_m / 2))
        run = min(self.total_m, distance_m + window_m / 2) - max(0.0, distance_m - window_m / 2)
        if run <= 0:
            return 0.0
        return 100.0 * (b[2] - a[2]) / run


# ---------------------------------------------------------------------------
# The route book
# ---------------------------------------------------------------------------

#: Real tracks, recorded by the project owner and exported from the route table of a
#: live install, kept in `real_routes.json`. Any track passing within 2 km of the
#: owner's home was dropped before export. Each entry is `[lat, lon, altitude_m]`.
_REAL_FILE = Path(__file__).with_name("real_routes.json")

#: id in the exported file -> (key, name, tolerance). Names are places, not people.
_REAL_NAMES: dict[int, tuple[str, str]] = {
    24: ("lusail_promenade_long", "Lusail promenade long run"),
    51: ("lusail_promenade", "Lusail promenade out and back"),
    53: ("west_bay_lagoon_loop", "Lagoon loop"),
    54: ("west_bay_lagoon_short", "Lagoon short loop"),
    57: ("corniche_long", "Corniche long out and back"),
    68: ("corniche_11k", "Corniche 11k out and back"),
    32: ("west_bay_loop", "West Bay loop"),
    65: ("lusail_ride", "Lusail ride"),
    67: ("al_khor_loop", "Al Khor loop"),
    70: ("doha_east_ride", "Doha east ride"),
    124: ("aamal_ride", "Aamal ride"),
    129: ("corniche_ride", "Corniche ride"),
}


def _length_m(points: Sequence[Sequence[float]]) -> float:
    lat0 = points[0][0]
    m_lon = M_PER_DEG_LAT * math.cos(math.radians(lat0))
    return sum(
        math.hypot((b[1] - a[1]) * m_lon, (b[0] - a[0]) * M_PER_DEG_LAT)
        for a, b in zip(points, points[1:])
    )


def _load_real() -> tuple[tuple[RouteTemplate, ...], dict[str, list]]:
    templates: list[RouteTemplate] = []
    points: dict[str, list] = {}
    for item in json.loads(_REAL_FILE.read_text()):
        key, name = _REAL_NAMES[item["id"]]
        pts = item["points"]
        templates.append(
            RouteTemplate(
                key=key, name=name, sport=item["sport"],
                anchor=(pts[0][0], pts[0][1]), nominal_m=_length_m(pts),
                tolerance=0.30 if item["sport"] == "cycling" else 0.25,
            )
        )
        points[key] = pts
    return tuple(templates), points


TEMPLATES, _REAL_POINTS = _load_real()

TEMPLATES_BY_KEY = {t.key: t for t in TEMPLATES}

#: Built routes are cached: the geometry is deterministic, so building the Corniche
#: loop 200 times would be 200 identical computations.
_CACHE: dict[str, Route] = {}


# ---------------------------------------------------------------------------
# Construction
# ---------------------------------------------------------------------------


def _raw_shape(t: RouteTemplate, n: int = 480) -> list[tuple[float, float]]:
    """Unit-scale (x, y) path in metres about the origin, before length calibration."""
    pts: list[tuple[float, float]] = []
    if t.shape == "loop":
        for i in range(n):
            th = 2 * math.pi * i / n
            r = 1.0 + 0.28 * math.sin(t.lobes * th + t.phase) + 0.13 * math.cos(
                (t.lobes + 2) * th + t.phase / 2
            )
            pts.append((r * math.cos(th), r * math.sin(th)))
        pts.append(pts[0])  # close the loop
    else:
        # Out-and-back: a wandering line out, then the same line home. The return
        # leg sitting exactly on top of the outbound one is realistic and is a good
        # stress test for the segment splitter.
        half = n // 2
        out: list[tuple[float, float]] = []
        for i in range(half + 1):
            u = i / half
            x = 2.0 * u
            y = 0.32 * math.sin(t.lobes * math.pi * u + t.phase) + 0.12 * math.sin(
                (t.lobes + 3) * math.pi * u
            )
            out.append((x, y))
        pts = out + list(reversed(out[:-1]))
    return pts


def build(template: RouteTemplate | str) -> Route:
    """Build (and cache) a route: scaled to its nominal distance, with elevation."""
    t = TEMPLATES_BY_KEY[template] if isinstance(template, str) else template
    if t.key in _CACHE:
        return _CACHE[t.key]

    pts = _REAL_POINTS[t.key]
    lats = [p[0] for p in pts]
    lons = [p[1] for p in pts]
    alts = [p[2] for p in pts]
    m_per_deg_lon = M_PER_DEG_LAT * math.cos(math.radians(lats[0]))
    cum = [0.0]
    for i in range(1, len(lats)):
        dx = (lons[i] - lons[i - 1]) * m_per_deg_lon
        dy = (lats[i] - lats[i - 1]) * M_PER_DEG_LAT
        cum.append(cum[-1] + math.hypot(dx, dy))

    route = Route(template=t, lats=lats, lons=lons, alts=alts, cum=cum)
    _CACHE[t.key] = route
    return route


def routes_for(sport: str) -> list[RouteTemplate]:
    return [t for t in TEMPLATES if t.sport == sport]


def pick(sport: str, target_m: float) -> Route | None:
    """The route closest in distance to what the session called for.

    Returns None when nothing is close enough — the caller then produces a
    GPS-less activity, which is exactly what a treadmill session looks like.
    """
    candidates = routes_for(sport)
    if not candidates:
        return None
    best = min(candidates, key=lambda t: abs(t.nominal_m - target_m))
    if abs(best.nominal_m - target_m) / best.nominal_m > best.tolerance:
        return None
    return build(best)


# ---------------------------------------------------------------------------
# Laying a run onto a route
# ---------------------------------------------------------------------------


def trace(
    route: Route,
    distances: Sequence[float],
    rng: random.Random,
    noise_m: float = 4.0,
) -> list[tuple[float, float, float]]:
    """Map a run's cumulative distances onto the route, with plausible GPS noise.

    Distances are mapped **proportionally**, so an attempt that measured 8 380 m and
    one that measured 8 450 m both cover the whole route — the difference reads as
    measurement error, which is what it is in real life. That keeps every attempt at
    a route the same shape, which is what clustering needs.

    The noise is a slow random walk rather than white noise: real GPS error drifts
    over tens of seconds, and white noise would make every track look equally bad.
    """
    if not distances:
        return []
    measured = max(distances[-1], 1e-6)
    m_per_deg_lon = M_PER_DEG_LAT * math.cos(math.radians(route.lats[0]))

    out: list[tuple[float, float, float]] = []
    ex = rng.gauss(0.0, noise_m)
    ey = rng.gauss(0.0, noise_m)
    for d in distances:
        along = route.total_m * (d / measured)
        lat, lon, alt = route.position_at(along)
        # Ornstein-Uhlenbeck-ish drift: pulled back toward zero, so error wanders
        # but does not run away.
        ex = ex * 0.90 + rng.gauss(0.0, noise_m * 0.45)
        ey = ey * 0.90 + rng.gauss(0.0, noise_m * 0.45)
        out.append(
            (
                lat + ey / M_PER_DEG_LAT,
                lon + ex / m_per_deg_lon,
                alt + rng.gauss(0.0, 0.35),
            )
        )
    return out
