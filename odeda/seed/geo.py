"""Synthetic route geometry for the seeder.

Every coordinate in this file is **generated from a formula**, not recorded. The
anchors are public landmarks in Doha so the demo map looks like somewhere rather
than the middle of the Atlantic; the paths themselves are parametric squiggles and
correspond to no real person's movements.

Why this exists: route clustering, segment analysis and the map are the headline
feature, and none of them can be demonstrated — or tested — against data where every
run is a fresh random walk. So the seeder picks from a fixed set of routes, and a
route is the *same shape every time it is run*, down to where the hills are. That is
what makes "you always slow down at 4.2 km" a real, checkable signal rather than noise.

Two pairs of routes (Corniche/West Bay at ~8.5 km, Corniche-short/Aspire at ~5 km)
deliberately share a distance while sitting in different parts of the city: if the
clusterer ever merges those, it is broken.
"""

from __future__ import annotations

import math
import random
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

CORNICHE = (25.2990, 51.5380)
ASPIRE = (25.2620, 51.4430)
EDUCATION_CITY = (25.3140, 51.4370)
THE_PEARL = (25.3690, 51.5490)
AL_BIDDA = (25.2900, 51.5230)
LUSAIL = (25.4300, 51.4900)

TEMPLATES: tuple[RouteTemplate, ...] = (
    RouteTemplate(
        key="aspire_short", name="Aspire Park short loop", sport="running",
        anchor=ASPIRE, nominal_m=3400, lobes=3, phase=0.4,
        hills=(Hill(at=0.55, height_m=6.0),),
    ),
    RouteTemplate(
        key="corniche_5k", name="Corniche 5k out-and-back", sport="running",
        anchor=CORNICHE, nominal_m=5000, shape="out_back", lobes=2,
        hills=(Hill(at=0.5, height_m=9.0, width=0.10),),
    ),
    RouteTemplate(
        key="aspire_loop", name="Aspire Park loop", sport="running",
        anchor=ASPIRE, nominal_m=5200, lobes=4, phase=1.1,
        hills=(Hill(at=0.3, height_m=7.0), Hill(at=0.78, height_m=5.0)),
    ),
    RouteTemplate(
        key="albidda_loop", name="Al Bidda Park loop", sport="running",
        anchor=AL_BIDDA, nominal_m=6400, lobes=3, phase=2.0,
        # Al Bidda genuinely has a rise; this is the route that teaches the
        # segment profile what a hill looks like.
        hills=(Hill(at=0.35, height_m=22.0, width=0.08), Hill(at=0.72, height_m=11.0)),
    ),
    RouteTemplate(
        key="edu_city_perimeter", name="Education City perimeter", sport="running",
        anchor=EDUCATION_CITY, nominal_m=7200, lobes=5, phase=0.7,
        hills=(Hill(at=0.45, height_m=12.0),),
    ),
    RouteTemplate(
        key="corniche_loop", name="Corniche loop", sport="running",
        anchor=CORNICHE, nominal_m=8400, lobes=3, phase=1.7,
        hills=(Hill(at=0.25, height_m=14.0, width=0.07), Hill(at=0.85, height_m=8.0)),
    ),
    RouteTemplate(
        key="west_bay_circuit", name="West Bay circuit", sport="running",
        anchor=(25.3210, 51.5310), nominal_m=8600, lobes=4, phase=0.2,
        hills=(Hill(at=0.6, height_m=16.0),),
    ),
    RouteTemplate(
        key="pearl_loop", name="The Pearl loop", sport="running",
        anchor=THE_PEARL, nominal_m=10500, lobes=4, phase=2.6,
        hills=(Hill(at=0.4, height_m=10.0), Hill(at=0.9, height_m=13.0)),
    ),
    RouteTemplate(
        key="corniche_long", name="Corniche long out-and-back", sport="running",
        anchor=CORNICHE, nominal_m=12600, shape="out_back", lobes=3, phase=0.9,
        hills=(Hill(at=0.5, height_m=18.0, width=0.09),),
    ),
    RouteTemplate(
        key="edu_city_long", name="Education City long loop", sport="running",
        anchor=EDUCATION_CITY, nominal_m=14800, lobes=5, phase=1.4,
        hills=(Hill(at=0.3, height_m=15.0), Hill(at=0.65, height_m=20.0, width=0.07)),
    ),
    RouteTemplate(
        key="lusail_long", name="Lusail long run", sport="running",
        anchor=LUSAIL, nominal_m=18000, lobes=4, phase=3.0,
        hills=(Hill(at=0.55, height_m=24.0, width=0.08),),
    ),
    RouteTemplate(
        key="half_route", name="Doha half marathon route", sport="running",
        anchor=CORNICHE, nominal_m=21100, shape="out_back", lobes=4, phase=2.2,
        hills=(Hill(at=0.5, height_m=26.0, width=0.10),),
    ),
    # --- cycling ---------------------------------------------------------
    RouteTemplate(
        key="dukhan_ride", name="Dukhan Road ride", sport="cycling",
        anchor=(25.2500, 51.3200), nominal_m=40000, shape="out_back", lobes=2,
        hills=(Hill(at=0.5, height_m=60.0, width=0.12),), tolerance=0.30,
    ),
    RouteTemplate(
        key="al_khor_ride", name="Al Khor ride", sport="cycling",
        anchor=(25.5500, 51.4700), nominal_m=62000, lobes=3, phase=1.0,
        hills=(Hill(at=0.35, height_m=45.0), Hill(at=0.75, height_m=38.0)), tolerance=0.30,
    ),
    RouteTemplate(
        key="sealine_ride", name="Sealine ride", sport="cycling",
        anchor=(25.0200, 51.5200), nominal_m=85000, shape="out_back", lobes=3, phase=0.5,
        hills=(Hill(at=0.5, height_m=80.0, width=0.14),), tolerance=0.30,
    ),
)

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

    raw = _raw_shape(t)

    # Scale the unit shape so the polyline is exactly `nominal_m` long.
    unit_len = sum(
        math.dist(raw[i - 1], raw[i]) for i in range(1, len(raw))
    )
    scale = t.nominal_m / unit_len

    lat0, lon0 = t.anchor
    m_per_deg_lon = M_PER_DEG_LAT * math.cos(math.radians(lat0))

    lats, lons = [], []
    for x, y in raw:
        lats.append(lat0 + (y * scale) / M_PER_DEG_LAT)
        lons.append(lon0 + (x * scale) / m_per_deg_lon)

    cum = [0.0]
    for i in range(1, len(lats)):
        dx = (lons[i] - lons[i - 1]) * m_per_deg_lon
        dy = (lats[i] - lats[i - 1]) * M_PER_DEG_LAT
        cum.append(cum[-1] + math.hypot(dx, dy))

    total = cum[-1]
    alts = []
    for d in cum:
        frac = d / total if total else 0.0
        alt = t.base_alt_m
        for h in t.hills:
            alt += h.height_m * math.exp(-(((frac - h.at) / h.width) ** 2))
        alts.append(round(alt, 2))

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
