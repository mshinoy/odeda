"""Physiologically plausible synthetic Garmin data.

Not noise dressed as data. The generator runs a simple athlete model forward day by
day so that the things the analytics look for actually exist in the output:

  * a 3-weeks-build / 1-week-recover mesocycle, so CTL ramps and TSB oscillates;
  * fitness that improves (threshold speed 3.18 -> 3.58 m/s), dragging VO2max, race
    paces and resting HR with it;
  * an illness block and a travel block, where RHR jumps, HRV collapses and training
    stops — the exact signature `analytics/trends.py` is built to flag;
  * HRV and resting HR that respond to *yesterday's* training load and *last night's*
    sleep, so the readiness score has real structure rather than independent noise;
  * cardiac drift inside long runs, decreasing as fitness improves, so aerobic
    decoupling trends downward instead of being random;
  * a handful of genuine hard efforts (parkruns, a 10 k, a half) so best-effort
    extraction and the Riegel projection have real races to work from.

Everything is seeded from a fixed RNG seed, so `seed --reset` twice gives byte-identical
output and the verification transcript stays reproducible.
"""

from __future__ import annotations

import math
import random
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta

from ..analytics import load as load_mod
from ..analytics import performance as perf
from ..analytics import routes as routes_mod
from ..config import Settings
from ..edits import gear as gear_mod
from . import geo

#: Three and a bit years. Long enough for year-over-year trends, seasonality and
#: routes with 40+ attempts; short enough to seed in a couple of minutes.
DEFAULT_MONTHS = 40

SEED = 20260922
SAMPLE_INTERVAL_S = 10  # see docs/history/DECISIONS.md D14
SEED_MARKER_ENDPOINT = "seed:synthetic"

# Share of sessions that happen indoors and therefore produce **no GPS at all**.
# Deliberately non-zero: "indoor activities must degrade gracefully, not crash" is a
# requirement, and a seed without a single treadmill run would never exercise it.
TREADMILL_RATE = 0.09
INDOOR_BIKE_RATE = 0.22

# Athlete model -------------------------------------------------------------------
HR_REST_START = 56.0
HR_MAX = 187.0
V_THR_START = 3.18   # m/s at lactate threshold, month 0  (~5:14/km)
V_THR_END = 3.58     # m/s at threshold, month 18         (~4:39/km)
WEIGHT_START = 78.5
WEIGHT_END = 74.0
HEIGHT_M = 1.79

# Body composition is modelled as lean mass plus fat mass, not as a weight and an
# unrelated fat percentage. Training adds a little lean mass while the diet takes fat
# off, so fat mass falls faster than the scale does — which is the whole point of the
# fat/lean split on the Health page. A fat percentage generated independently of the
# weight it belongs to would make that chart show nothing but two parallel lines.
LEAN_KG_START = 62.5
LEAN_KG_END = 63.3

# A scale reading is the true weight plus whatever the body is holding that morning.
# 0.55 kg is about right for one overnight-fasted reading and is large enough to hide a
# week of real change, which is why nothing downstream may present one reading as news.
HYDRATION_SD_KG = 0.55

# The true weight wanders around the plan's smooth curve: plateaus, a bad fortnight,
# a week of travel. Modelled as a mean-reverting random walk so the trend line has
# something to find, clamped so three years of it cannot wander into fiction.
WEIGHT_WALK_SD_KG = 0.09
WEIGHT_WALK_DECAY = 0.985
WEIGHT_WALK_LIMIT_KG = 1.6
TRAVEL_WEIGHT_KG = 0.5

# Weighing happens in runs — a month of most mornings, then a fortnight of none —
# rather than as an even coin flip per day. Every trend in analytics/body.py degrades
# with gaps, so the gaps have to exist in the data the charts are demonstrated on.
# Off the habit for ~8 days at a time, on it for ~50; ~69 % of days end up with a
# reading, which is roughly five mornings a week.
LOSES_THE_HABIT = 0.02
REGAINS_THE_HABIT = 0.12
WEIGHS_IN_WHEN_IN_THE_HABIT = 0.80

# Session templates: (name, kind, share of weekly volume, intensity as fraction of v_thr)
RUN_KINDS = {
    "easy":      {"intensity": 0.82, "drift": 1.00},
    "long":      {"intensity": 0.79, "drift": 1.60},
    "tempo":     {"intensity": 0.99, "drift": 1.10},
    "intervals": {"intensity": 1.15, "drift": 1.05},
    "recovery":  {"intensity": 0.74, "drift": 0.90},
    "race":      {"intensity": 1.10, "drift": 1.20},
}

# Race intensity as a fraction of threshold speed. A 5 k is run well above threshold,
# a half a touch below it — using one number for all of them produces a half marathon
# at 5 k pace, which then poisons every Riegel projection downstream.
RACE_INTENSITY = {"5k": 1.10, "10k": 1.05, "half": 0.99}

# Divisor converting a day's TRIMP into accumulated fatigue. Sized so a typical
# training week settles around 0.5 rather than pinning the 1.0 cap, where the fatigue
# term would degenerate into a constant speed penalty and stop meaning anything.
FATIGUE_DIVISOR = 900.0
RACE_LABELS = {"5k": "parkrun 5 k", "10k": "10 k race", "half": "Half marathon"}

# Weekly volume in km by mesocycle week, scaled by the progression factor.
BASE_WEEK_KM = 28.0
PEAK_WEEK_KM = 52.0
MESO = [1.00, 1.08, 1.15, 0.72]  # build, build, build, recover


@dataclass
class DayPlan:
    day: date
    sessions: list[dict]
    rest: bool = False
    disrupted: str | None = None  # 'illness' | 'travel'


@dataclass
class AthleteState:
    hr_rest: float = HR_REST_START
    hrv_base: float = 62.0
    fatigue: float = 0.0          # short-term, drives HRV/RHR response
    weight: float = WEIGHT_START
    #: Departure of the true weight from the plan's smooth curve. Carried between days
    #: because a plateau lasts weeks; a fresh draw each day would be noise, not drift.
    weight_walk: float = 0.0
    #: Whether the athlete is currently in the habit of weighing themselves.
    weighs_in: bool = True
    vo2max: float = 46.0
    history: list = field(default_factory=list)


# ---------------------------------------------------------------------------
# Body composition
# ---------------------------------------------------------------------------


def advance_weight(rng, state: AthleteState, progress_frac: float, travelling: bool) -> None:
    """Move the athlete's true weight one day along the block, plus its own wandering.

    Nobody loses weight along a smooth curve. The mean-reverting walk produces the
    plateaus and the bad fortnights, which is what the trend line on the Health page
    exists to find; without it the smoothing would have nothing to smooth and the chart
    would prove nothing.
    """
    walk = state.weight_walk * WEIGHT_WALK_DECAY + rng.gauss(0, WEIGHT_WALK_SD_KG)
    state.weight_walk = max(-WEIGHT_WALK_LIMIT_KG, min(WEIGHT_WALK_LIMIT_KG, walk))
    trend = WEIGHT_START + (WEIGHT_END - WEIGHT_START) * progress_frac
    state.weight = trend + state.weight_walk + (TRAVEL_WEIGHT_KG if travelling else 0.0)


def steps_on_the_scale(rng, state: AthleteState) -> bool:
    """Whether today produces a reading. The habit comes and goes in runs, not per day."""
    if state.weighs_in:
        state.weighs_in = rng.random() >= LOSES_THE_HABIT
    else:
        state.weighs_in = rng.random() < REGAINS_THE_HABIT
    return state.weighs_in and rng.random() < WEIGHS_IN_WHEN_IN_THE_HABIT


def body_row(rng, day: date, progress_frac: float, true_weight_kg: float) -> dict:
    """One morning on the scale: a reading, and everything else derived from it.

    Lean mass follows the training block; fat mass is whatever the rest of the reading
    is. Putting the hydration noise on the *reading* rather than on the body is what
    makes the fat percentage move with the weight it was measured alongside — a real
    impedance scale behaves that way, and a fat percentage drawn independently of its
    own weight would make the fat/lean split two parallel lines that mean nothing.
    """
    reading = true_weight_kg + rng.gauss(0, HYDRATION_SD_KG)
    lean = LEAN_KG_START + (LEAN_KG_END - LEAN_KG_START) * progress_frac
    fat = max(reading - lean, 0.05 * reading)
    return {
        "day": day.isoformat(),
        "weight_kg": round(reading, 2),
        "body_fat_pct": round(100.0 * fat / reading, 1),
        "bmi": round(reading / (HEIGHT_M ** 2), 1),
    }


# ---------------------------------------------------------------------------
# Plan construction
# ---------------------------------------------------------------------------


def progression(day_index: int, total_days: int) -> float:
    """0 -> 1 over the training block, easing off (not linear) so early weeks build fast."""
    x = day_index / max(total_days - 1, 1)
    return x ** 0.85


def week_km(week_index: int, progress: float) -> float:
    base = BASE_WEEK_KM + (PEAK_WEEK_KM - BASE_WEEK_KM) * progress
    return base * MESO[week_index % len(MESO)]


def v_threshold(progress: float) -> float:
    return V_THR_START + (V_THR_END - V_THR_START) * progress


def build_plan(start: date, end: date, rng: random.Random) -> list[DayPlan]:
    """Lay out the whole block: which days have which sessions, plus disruptions."""
    total_days = (end - start).days + 1

    # Two disruption blocks at fixed-ish points so every run of the seeder has them.
    illness_start = start + timedelta(days=int(total_days * 0.33))
    illness = {illness_start + timedelta(days=i) for i in range(6)}
    travel_start = start + timedelta(days=int(total_days * 0.68))
    travel = {travel_start + timedelta(days=i) for i in range(9)}

    # Hard efforts: a parkrun-style 5 k roughly monthly, plus tune-up 10 ks and halves.
    # The later 10 k and half matter: without a long hard effort in the last few months
    # the race panel has nothing recent to project a half marathon from.
    RACE_WEEKS = {14: "10k", 26: "half", 42: "10k", 66: "half", 72: "10k"}
    races: dict[date, tuple[str, float]] = {}
    cursor = start + timedelta(days=(5 - start.weekday()) % 7)  # first Saturday
    n = 0
    while cursor <= end:
        if cursor not in illness and cursor not in travel:
            n += 1
            if n % 4 == 0:
                races[cursor] = ("5k", 5000.0)
            if n in RACE_WEEKS:
                label = RACE_WEEKS[n]
                races[cursor] = (label, {"5k": 5000.0, "10k": 10000.0, "half": 21097.5}[label])
        cursor += timedelta(days=7)

    plans: list[DayPlan] = []
    week_index = 0
    cur = start
    while cur <= end:
        di = (cur - start).days
        progress = progression(di, total_days)
        if cur.weekday() == 0 and di:
            week_index += 1
        wk_km = week_km(week_index, progress)

        disrupted = "illness" if cur in illness else ("travel" if cur in travel else None)
        sessions: list[dict] = []

        if disrupted == "illness":
            pass  # nothing at all
        elif disrupted == "travel":
            if cur.weekday() in (2, 5):
                sessions.append({"kind": "easy", "km": round(wk_km * 0.12, 2), "sport": "running"})
        elif cur in races:
            label, dist = races[cur]
            sessions.append({"kind": "race", "km": dist / 1000.0, "sport": "running",
                             "name": RACE_LABELS[label],
                             "intensity": RACE_INTENSITY[label]})
            if label != "half":
                sessions.append({"kind": "recovery", "km": round(wk_km * 0.08, 2), "sport": "running",
                                 "name": "Cool-down jog"})
        else:
            wd = cur.weekday()
            if wd == 0:      # Monday — rest, or a swim
                if rng.random() < 0.35:
                    sessions.append({"kind": "cross", "sport": "swimming",
                                     "minutes": rng.choice([30, 35, 40])})
            elif wd == 1:    # Tuesday — intervals
                sessions.append({"kind": "intervals", "km": round(wk_km * 0.16, 2), "sport": "running"})
            elif wd == 2:    # Wednesday — easy
                sessions.append({"kind": "easy", "km": round(wk_km * 0.15, 2), "sport": "running"})
            elif wd == 3:    # Thursday — tempo
                sessions.append({"kind": "tempo", "km": round(wk_km * 0.17, 2), "sport": "running"})
            elif wd == 4:    # Friday — easy or off
                if rng.random() < 0.6:
                    sessions.append({"kind": "recovery", "km": round(wk_km * 0.11, 2), "sport": "running"})
            elif wd == 5:    # Saturday — long run
                sessions.append({"kind": "long", "km": round(wk_km * 0.30, 2), "sport": "running"})
            else:            # Sunday — easy, or a bike
                # The Sundays one and three weeks before the end are always a ride, so a
                # fresh demo has a couple of recent rides whatever the draws said. The
                # draw is still made, so everything before those days is unchanged.
                force_ride = (end - cur).days // 7 in (1, 3)
                if rng.random() < 0.45 or force_ride:
                    # Mostly a club-length spin, occasionally a proper long ride —
                    # which is what puts activities on the longer cycling routes.
                    minutes = rng.choices(
                        [50, 60, 75, 90, 140, 200], weights=[3, 4, 4, 3, 2, 1]
                    )[0]
                    sessions.append({"kind": "cross", "sport": "cycling",
                                     "minutes": minutes})
                else:
                    sessions.append({"kind": "easy", "km": round(wk_km * 0.11, 2), "sport": "running"})

            if wd in (1, 3) and rng.random() < 0.25:
                sessions.append({"kind": "strength", "sport": "strength_training",
                                 "minutes": rng.choice([30, 40, 45])})

        plans.append(DayPlan(day=cur, sessions=sessions, rest=not sessions, disrupted=disrupted))
        cur += timedelta(days=1)
    return plans


# ---------------------------------------------------------------------------
# Activity synthesis
# ---------------------------------------------------------------------------


def hr_for_speed(speed: float, v_thr: float, hr_rest: float, hr_max: float) -> float:
    """Speed -> heart rate. Calibrated so threshold pace lands at ~85 % HR reserve."""
    ratio = max(speed / v_thr, 0.05)
    hrr = 0.85 * ratio ** 0.9
    return hr_rest + min(hrr, 1.02) * (hr_max - hr_rest)


def hr_zone(hr: float, hr_rest: float, hr_max: float) -> int:
    hrr = (hr - hr_rest) / (hr_max - hr_rest)
    for zone, upper in ((1, 0.60), (2, 0.70), (3, 0.80), (4, 0.90)):
        if hrr < upper:
            return zone
    return 5


def synth_run(
    rng: random.Random,
    kind: str,
    target_km: float,
    v_thr: float,
    hr_rest: float,
    fatigue: float,
    intensity: float | None = None,
    route: "geo.Route | None" = None,
) -> dict:
    """Generate a run's sample stream and its aggregates.

    Interval sessions alternate work and float blocks; long runs carry cardiac drift;
    races go out slightly hot and hang on. The shape matters because best-effort
    extraction and decoupling both read the stream, not the summary.

    When a `route` is supplied the run is laid onto it: altitude comes from the
    route's fixed profile, and **speed is modulated by the gradient at that point**
    while heart rate is computed from the flat-equivalent speed. That is what a
    runner holding effort actually does — slow on the climb, HR steady — and it is
    what makes the segment profile show a real, repeatable slow-down at the hill
    instead of noise.
    """
    tmpl = RUN_KINDS[kind]
    base_intensity = (intensity or tmpl["intensity"]) * rng.uniform(0.985, 1.015)
    # Fatigue costs speed at a given effort.
    base_speed = v_thr * base_intensity * (1.0 - 0.05 * min(fatigue, 1.0))
    # A race course is measured: it is never short. Everything else varies a little.
    spread = rng.uniform(1.0, 1.015) if kind == "race" else rng.uniform(0.97, 1.03)
    distance_target = target_km * 1000.0 * spread

    elapsed: list[float] = [0.0]
    dist: list[float] = [0.0]
    hrs: list[float] = []
    cadences: list[float] = []
    alts: list[float] = []

    est_duration = distance_target / base_speed
    drift_total = 0.055 * tmpl["drift"] * rng.uniform(0.7, 1.3)

    t = 0.0
    d = 0.0
    alt = 12.0
    hr_prev = hr_rest + 25.0
    while d < distance_target:
        frac = min(t / est_duration, 1.2)

        if kind == "intervals":
            # 4 min hard / 2 min float, after a 10 min warm-up.
            if t < 600:
                speed = base_speed * 0.78
            else:
                phase = (t - 600) % 360
                speed = base_speed * (1.0 if phase < 240 else 0.72)
        elif kind == "race":
            speed = base_speed * (1.03 - 0.06 * frac + 0.04 * frac ** 3)
        elif kind == "long":
            speed = base_speed * (1.02 - 0.05 * frac)
        else:
            speed = base_speed * (0.94 + 0.10 * min(frac * 2.5, 1.0))

        speed *= rng.gauss(1.0, 0.025)
        speed = max(speed, 1.6)

        # HR reflects the effort being held, so it is taken from the flat-equivalent
        # speed *before* the hill slows the runner down.
        flat_speed = speed
        gradient = 0.0
        if route is not None:
            gradient = route.gradient_at(route.total_m * min(d / distance_target, 1.0))
            # ~3.5 % slower per 1 % of climb; descents give back about half that.
            cost = 0.035 * gradient if gradient > 0 else 0.018 * gradient
            speed = max(1.4, speed * max(0.72, min(1.18, 1.0 - cost)))

        target_hr = hr_for_speed(flat_speed, v_thr, hr_rest, HR_MAX)
        target_hr *= 1.0 + drift_total * frac          # cardiac drift
        target_hr *= 1.0 + 0.012 * max(0.0, gradient)  # climbing still costs a little
        target_hr += rng.gauss(0.0, 1.4)
        # First-order lag: HR does not step, it chases.
        hr = hr_prev + (target_hr - hr_prev) * 0.35
        hr = max(hr_rest + 10.0, min(hr, HR_MAX))
        hr_prev = hr

        if route is None:
            alt += rng.gauss(0.0, 0.55)
            alt = max(2.0, min(alt, 60.0))
        else:
            alt = route.position_at(route.total_m * min(d / distance_target, 1.0))[2]

        d += speed * SAMPLE_INTERVAL_S
        t += SAMPLE_INTERVAL_S
        elapsed.append(t)
        dist.append(d)
        hrs.append(hr)
        cadences.append(164 + 14 * (speed / v_thr) + rng.gauss(0, 1.5))
        alts.append(alt)

    # Pad the leading sample so every list is the same length as `elapsed`.
    hrs.insert(0, hrs[0])
    cadences.insert(0, cadences[0])
    alts.insert(0, alts[0])

    speeds = [0.0] + [
        (dist[i] - dist[i - 1]) / SAMPLE_INTERVAL_S for i in range(1, len(dist))
    ]

    zone_seconds: dict[int, float] = {}
    for hr in hrs[1:]:
        z = hr_zone(hr, hr_rest, HR_MAX)
        zone_seconds[z] = zone_seconds.get(z, 0.0) + SAMPLE_INTERVAL_S

    gain = sum(max(0.0, alts[i] - alts[i - 1]) for i in range(1, len(alts)))
    avg_hr = sum(hrs[1:]) / len(hrs[1:])
    duration = elapsed[-1]

    # Lay the run onto the route's geometry. Indoor sessions get no track at all,
    # and every consumer has to cope with that.
    if route is None:
        track: list[tuple[float, float, float] | None] = [None] * len(elapsed)
    else:
        traced = geo.trace(route, dist, rng)
        track = list(traced)
        # The traced altitude is the route's, with noise; prefer it over the
        # bookkeeping copy so map and elevation profile agree exactly.
        alts = [p[2] for p in traced]

    return {
        "route_key": route.template.key if route else None,
        "route_name": route.name if route else None,
        "track": track,
        "distance_m": dist[-1],
        "duration_s": duration * rng.uniform(1.0, 1.03),  # elapsed >= moving
        "moving_time_s": duration,
        "avg_hr": avg_hr,
        "max_hr": max(hrs),
        "avg_speed_mps": dist[-1] / duration,
        "max_speed_mps": max(speeds),
        "elevation_gain_m": gain,
        "avg_cadence_spm": sum(cadences) / len(cadences),
        "calories": duration / 60.0 * (0.85 * WEIGHT_START / 70.0) * 11.0,
        "zone_seconds": zone_seconds,
        "samples": list(zip(elapsed, dist, hrs, speeds, cadences, alts, track)),
    }


def synth_ride(
    rng: random.Random,
    minutes: float,
    hr_rest: float,
    route: "geo.Route | None" = None,
) -> dict:
    """A bike ride with a GPS track, so bikes get routes and real mileage.

    Coarser sampling than a run (rides are long, and nobody analyses a 3-hour ride
    at 5-second resolution in a browser).
    """
    if route is None:
        return synth_other(rng, "cycling", minutes, hr_rest)

    duration = minutes * 60.0
    distance = route.total_m * rng.uniform(0.995, 1.005)
    base_speed = distance / duration
    step = 20.0

    elapsed, dist, hrs, cadences, alts = [0.0], [0.0], [], [], []
    t, d = 0.0, 0.0
    hr_prev = hr_rest + 30.0
    hrr = rng.uniform(0.60, 0.74)
    while d < distance and t < duration * 1.6:
        gradient = route.gradient_at(route.total_m * min(d / distance, 1.0))
        speed = base_speed * max(0.45, min(1.45, 1.0 - 0.055 * gradient)) * rng.gauss(1.0, 0.03)
        speed = max(2.0, speed)
        target_hr = hr_rest + hrr * (HR_MAX - hr_rest) * (1.0 + 0.02 * max(0.0, gradient))
        hr_prev += (target_hr + rng.gauss(0, 2.0) - hr_prev) * 0.3
        hr = max(hr_rest + 10.0, min(hr_prev, HR_MAX))

        d += speed * step
        t += step
        elapsed.append(t)
        dist.append(d)
        hrs.append(hr)
        cadences.append(rng.gauss(84, 4))
        alts.append(route.position_at(route.total_m * min(d / distance, 1.0))[2])

    hrs.insert(0, hrs[0])
    cadences.insert(0, cadences[0])
    alts.insert(0, alts[0])
    speeds = [0.0] + [(dist[i] - dist[i - 1]) / step for i in range(1, len(dist))]
    traced = geo.trace(route, dist, rng, noise_m=6.0)
    alts = [p[2] for p in traced]

    zone_seconds: dict[int, float] = {}
    for hr in hrs[1:]:
        z = hr_zone(hr, hr_rest, HR_MAX)
        zone_seconds[z] = zone_seconds.get(z, 0.0) + step

    gain = sum(max(0.0, alts[i] - alts[i - 1]) for i in range(1, len(alts)))
    moving = elapsed[-1]
    return {
        "route_key": route.template.key,
        "route_name": route.name,
        "distance_m": dist[-1],
        "duration_s": moving * rng.uniform(1.02, 1.09),  # coffee stops
        "moving_time_s": moving,
        "avg_hr": sum(hrs[1:]) / len(hrs[1:]),
        "max_hr": max(hrs),
        "avg_speed_mps": dist[-1] / moving,
        "max_speed_mps": max(speeds),
        "elevation_gain_m": gain,
        "avg_cadence_spm": sum(cadences) / len(cadences),
        "avg_power_w": rng.uniform(150, 215),
        "calories": minutes * 7.6,
        "zone_seconds": zone_seconds,
        "track": list(traced),
        "samples": list(zip(elapsed, dist, hrs, speeds, cadences, alts, traced)),
    }


#: Two strength days a runner might alternate: legs and core, then upper body. The names
#: are Garmin's own exercise categories, which the app turns into muscles, so a seeded
#: session lights up the body diagram the way a real one does. Each entry is
#: (category, sub-category, sets, reps per set, working weight in kg).
GYM_DAYS = (
    (
        ("SQUAT", "BARBELL_BACK_SQUAT", 4, 8, 80),
        ("DEADLIFT", "ROMANIAN_DEADLIFT", 3, 8, 70),
        ("LUNGE", "DUMBBELL_LUNGE", 3, 10, 20),
        ("CALF_RAISE", "STANDING_CALF_RAISE", 3, 15, 40),
        ("CRUNCH", "CABLE_CRUNCH", 3, 15, 30),
    ),
    (
        ("BENCH_PRESS", "BARBELL_BENCH_PRESS", 4, 8, 60),
        ("ROW", "BARBELL_ROW", 4, 8, 55),
        ("SHOULDER_PRESS", "DUMBBELL_SHOULDER_PRESS", 3, 10, 18),
        ("PULL_UP", "LAT_PULLDOWN", 3, 10, 50),
        ("CURL", "DUMBBELL_BICEPS_CURL", 3, 12, 12),
    ),
)


def gym_payload(activity_id: str, day: date) -> dict:
    """The exercise part of a strength session's raw payload, as Garmin sends it.

    It has its own random source, seeded from the activity id, so it never consumes the
    main stream: adding it changed nothing else in the seeded history. Weights creep up
    over the years and land on 2.5 kg plates.
    """
    rng = random.Random(f"gym-{activity_id}")
    plan = GYM_DAYS[(day.toordinal() // 7 + day.weekday()) % 2]
    weeks = max(0, (day - date(2023, 1, 1)).days // 7)
    factor = 0.8 + min(weeks, 170) * 0.0017
    entries = []
    for category, sub, sets, reps, kg in plan:
        sets = max(2, sets + rng.choice((-1, 0, 0, 1)))
        weight_kg = round(kg * factor / 2.5) * 2.5
        total_reps = sets * reps - rng.randint(0, 2)
        entries.append({
            "category": category,
            "subCategory": sub,
            "sets": sets,
            "reps": total_reps,
            "maxWeight": weight_kg * 1000.0,
            "volume": weight_kg * 1000.0 * total_reps,
            "duration": sets * rng.randint(70, 110) * 1000,
        })
    total_sets = sum(e["sets"] for e in entries)
    return {
        "summarizedExerciseSets": entries,
        "totalSets": total_sets,
        "activeSets": total_sets,
        "totalReps": sum(e["reps"] for e in entries),
    }


def synth_other(rng: random.Random, sport: str, minutes: float, hr_rest: float) -> dict:
    """Swim / strength / indoor: aggregates only, no sample stream and no GPS."""
    profile = {
        "cycling": (0.62, 0.72, 7.6),
        "indoor_cycling": (0.64, 0.75, 7.8),
        "swimming": (0.58, 0.66, 8.5),
        "strength_training": (0.42, 0.55, 5.5),
    }.get(sport, (0.50, 0.62, 6.0))
    lo, hi, kcal_min = profile
    hrr = rng.uniform(lo, hi)
    avg_hr = hr_rest + hrr * (HR_MAX - hr_rest)
    duration = minutes * 60.0
    zone = hr_zone(avg_hr, hr_rest, HR_MAX)
    out = {
        "route_key": None,
        "route_name": None,
        "track": [],
        "distance_m": duration * rng.uniform(6.8, 8.2) if "cycling" in sport else (
            duration * 0.62 if sport == "swimming" else None
        ),
        "duration_s": duration,
        "moving_time_s": duration * rng.uniform(0.93, 1.0),
        "avg_hr": avg_hr,
        "max_hr": avg_hr * rng.uniform(1.08, 1.16),
        # An indoor trainer records no climbing however hard the ERG file is.
        "elevation_gain_m": duration / 60.0 * rng.uniform(2, 9) if sport == "cycling" else 0.0,
        "avg_cadence_spm": rng.uniform(78, 92) if "cycling" in sport else None,
        "avg_power_w": rng.uniform(150, 215) if "cycling" in sport else None,
        "calories": minutes * kcal_min,
        "zone_seconds": {zone: duration * 0.6, max(1, zone - 1): duration * 0.4},
        "samples": [],
    }
    out["avg_speed_mps"] = (out["distance_m"] / out["moving_time_s"]) if out["distance_m"] else None
    out["max_speed_mps"] = (out["avg_speed_mps"] * 1.25) if out["avg_speed_mps"] else None
    return out


# ---------------------------------------------------------------------------
# Wellness synthesis
# ---------------------------------------------------------------------------


def synth_night(
    rng: random.Random,
    day: date,
    state: AthleteState,
    yesterday_trimp: float,
    disrupted: str | None,
) -> dict:
    """One night's sleep. Weekends run later and longer; travel wrecks it."""
    weekend = day.weekday() in (4, 5)
    base_h = 7.25 + (0.55 if weekend else 0.0)
    if disrupted == "travel":
        base_h -= 1.4
    if disrupted == "illness":
        base_h += 0.5
    # A very hard day costs a little sleep quality, not quantity.
    hours = max(3.8, rng.gauss(base_h, 0.62))
    total_s = hours * 3600.0

    deep_frac = max(0.08, rng.gauss(0.18, 0.035) - (0.02 if disrupted == "travel" else 0))
    rem_frac = max(0.10, rng.gauss(0.21, 0.04))
    awake_frac = min(0.18, max(0.02, rng.gauss(0.055, 0.025) + (0.04 if disrupted else 0)))
    light_frac = max(0.25, 1.0 - deep_frac - rem_frac - awake_frac)

    score = (
        52
        + 26 * min(hours / 8.0, 1.15)
        + 60 * (deep_frac - 0.18)
        + 40 * (rem_frac - 0.21)
        - 120 * max(0.0, awake_frac - 0.06)
        - 0.02 * yesterday_trimp
        + rng.gauss(0, 4.5)
    )
    if disrupted == "illness":
        score -= 12
    score = max(20.0, min(98.0, score))

    bed_hour = 22 + (1 if weekend else 0)
    bedtime = datetime.combine(day - timedelta(days=1), time(hour=bed_hour)) + timedelta(
        minutes=rng.gauss(0, 38)
    )
    waketime = bedtime + timedelta(seconds=total_s / (1 - awake_frac))

    return {
        "day": day.isoformat(),
        "total_sleep_s": round(total_s),
        "deep_s": round(total_s * deep_frac),
        "light_s": round(total_s * light_frac),
        "rem_s": round(total_s * rem_frac),
        "awake_s": round(total_s * awake_frac),
        "sleep_score": round(score, 1),
        "avg_respiration_brpm": round(rng.gauss(14.2, 0.9) + (1.6 if disrupted == "illness" else 0), 1),
        "avg_spo2_pct": round(rng.gauss(95.6, 1.1), 1),
        "bedtime_local": bedtime.strftime("%Y-%m-%dT%H:%M:%S"),
        "waketime_local": waketime.strftime("%Y-%m-%dT%H:%M:%S"),
    }


def synth_wellness(
    rng: random.Random,
    day: date,
    state: AthleteState,
    sleep_row: dict,
    today_trimp: float,
    yesterday_trimp: float,
    disrupted: str | None,
    ran_today: bool,
) -> tuple[dict, dict]:
    """Daily wellness + HRV, both reacting to load and sleep rather than drifting freely."""
    sleep_h = sleep_row["total_sleep_s"] / 3600.0
    sleep_score = sleep_row["sleep_score"]

    # Resting HR: own baseline, plus yesterday's load, minus good sleep, plus illness.
    rhr = (
        state.hr_rest
        + 0.016 * yesterday_trimp
        - 0.035 * (sleep_score - 72)
        + (7.5 if disrupted == "illness" else 0.0)
        + (1.8 if disrupted == "travel" else 0.0)
        + rng.gauss(0, 1.15)
    )

    # HRV: inverse of the same drivers, with more night-to-night noise (as in reality).
    hrv = (
        state.hrv_base
        - 0.030 * yesterday_trimp
        + 0.10 * (sleep_score - 72)
        - (14.0 if disrupted == "illness" else 0.0)
        - (4.5 if disrupted == "travel" else 0.0)
        + rng.gauss(0, 3.6)
    )
    hrv = max(18.0, hrv)

    stress_avg = (
        26
        + 0.035 * today_trimp
        - 0.12 * (sleep_score - 72)
        + (14 if disrupted == "illness" else 0)
        + (9 if disrupted == "travel" else 0)
        + rng.gauss(0, 5)
    )
    stress_avg = max(8.0, min(88.0, stress_avg))

    bb_charged = max(12, min(100, round(18 + 6.2 * sleep_h + 0.25 * (sleep_score - 60) + rng.gauss(0, 6))))
    bb_drained = max(10, min(100, round(30 + 0.10 * today_trimp + 0.35 * stress_avg + rng.gauss(0, 7))))
    bb_high = max(25, min(100, round(30 + bb_charged * 0.72 + rng.gauss(0, 5))))
    bb_low = max(5, min(bb_high - 5, round(bb_high - bb_drained * 0.78 + rng.gauss(0, 5))))

    steps = round(
        (3200 if disrupted == "illness" else 6200)
        + (4200 if ran_today else 0)
        + rng.gauss(0, 1400)
    )
    steps = max(600, steps)

    wellness = {
        "day": day.isoformat(),
        "resting_hr": round(rhr, 1),
        "steps": steps,
        "floors": max(0, round(rng.gauss(9, 4))),
        "calories_total": round(2180 + 0.9 * today_trimp * 4 + rng.gauss(0, 120)),
        "calories_active": round(320 + today_trimp * 3.4 + rng.gauss(0, 90)),
        "intensity_minutes_mod": max(0, round(rng.gauss(24, 14) + (0 if ran_today else -10))),
        "intensity_minutes_vig": max(0, round(today_trimp * 0.35 + rng.gauss(0, 6))),
        "stress_avg": round(stress_avg, 1),
        "stress_max": round(min(99.0, stress_avg + rng.uniform(22, 45)), 1),
        "bb_high": bb_high,
        "bb_low": bb_low,
        "bb_charged": bb_charged,
        "bb_drained": bb_drained,
    }

    # Garmin's own 7-day HRV baseline and status.
    state.history.append(hrv)
    recent = state.history[-7:]
    weekly = sum(recent) / len(recent)
    base_lo, base_hi = state.hrv_base * 0.88, state.hrv_base * 1.12
    if weekly < base_lo * 0.85:
        status = "POOR"
    elif weekly < base_lo:
        status = "LOW"
    elif weekly > base_hi:
        status = "UNBALANCED"
    else:
        status = "BALANCED"

    hrv_row = {
        "day": day.isoformat(),
        "last_night_avg": round(hrv, 1),
        "last_night_5min_high": round(hrv * rng.uniform(1.15, 1.4), 1),
        "weekly_avg": round(weekly, 1),
        "baseline_low": round(base_lo, 1),
        "baseline_high": round(base_hi, 1),
        "status": status,
    }
    return wellness, hrv_row


# ---------------------------------------------------------------------------
# Driver
# ---------------------------------------------------------------------------


def seed_database(
    store,
    end: date | None = None,
    months: int = DEFAULT_MONTHS,
    reset: bool = False,
    rng_seed: int = SEED,
    progress=None,
    cluster: bool = True,
    gear_data: bool = True,
) -> dict[str, int]:
    """Generate and load `months` of synthetic data ending on `end` (default today).

    Defaults to more than three years so that routes have dozens of attempts each,
    year-over-year comparisons have years to compare, and the aggregate views are
    answering the question the user actually asked ("if I've run 300 times over the
    past five years, what's my average pace").
    """
    settings: Settings = store.settings
    rng = random.Random(rng_seed)
    end = end or date.today()
    start = end - timedelta(days=int(months * 30.44))

    if reset:
        with store.tx() as conn:
            for table in (
                # Order matters: children before parents, so foreign keys stay happy.
                "route_segment_efforts", "route_members", "routes",
                "gear_defaults", "activity_gear", "gear", "overrides",
                "best_efforts", "activity_samples", "activity_hr_zones", "activities",
                "sleep", "daily_wellness", "hrv_daily", "fitness", "body_composition",
                "raw_documents", "sync_watermark",
            ):
                conn.execute(f"DELETE FROM {table}")

    plans = build_plan(start, end, rng)
    total_days = len(plans)
    state = AthleteState()

    counts = {"activities": 0, "samples": 0, "days": 0, "raw": 0}
    yesterday_trimp = 0.0
    activity_seq = 0
    #: activity_id -> the route template it was generated from. Ground truth the
    #: clusterer never sees; used only to name the resulting routes afterwards.
    route_keys: dict[str, str] = {}

    with store.tx():
        for i, plan in enumerate(plans):
            progress_frac = progression(i, total_days)
            v_thr = v_threshold(progress_frac)

            # Slow drift of the athlete's own baselines with training age.
            state.hr_rest = HR_REST_START - 5.0 * progress_frac
            state.hrv_base = 62.0 + 9.0 * progress_frac
            advance_weight(rng, state, progress_frac, plan.disrupted == "travel")
            state.vo2max = 46.0 + 7.0 * progress_frac

            today_trimp = 0.0
            ran_today = False

            for s_i, session in enumerate(plan.sessions):
                activity_seq += 1
                sport = session["sport"]
                if sport == "running":
                    # Runners run known loops. Snapping the session's distance to a
                    # real route is both more realistic than a fresh random walk and
                    # the only way repeated routes exist to be clustered at all.
                    route = geo.pick("running", session["km"] * 1000.0)
                    indoor = rng.random() < TREADMILL_RATE
                    if indoor:
                        route = None
                    detail = synth_run(
                        rng, session["kind"], session["km"], v_thr, state.hr_rest,
                        state.fatigue, session.get("intensity"), route=route,
                    )
                    if indoor:
                        detail["_sport"] = "treadmill_running"
                    ran_today = True
                elif sport == "cycling":
                    # The last five weeks' Sunday rides are outdoors and long enough to
                    # follow a known route, so a fresh demo shows current rides on the
                    # map. The random draws are the same as before; only the outcome
                    # of the last few weeks changes.
                    recent_sunday = plan.day.weekday() == 6 and (end - plan.day).days <= 35
                    if rng.random() < INDOOR_BIKE_RATE and not recent_sunday:
                        detail = synth_other(rng, "indoor_cycling", session["minutes"],
                                             state.hr_rest)
                        detail["_sport"] = "indoor_cycling"
                    else:
                        minutes = 90 if recent_sunday else session["minutes"]
                        route = geo.pick("cycling", minutes * 60.0 * 7.5)
                        detail = synth_ride(rng, minutes, state.hr_rest, route=route)
                else:
                    detail = synth_other(rng, sport, session["minutes"], state.hr_rest)

                aid = f"seed-{activity_seq:06d}"
                sport = detail.get("_sport", sport)
                if detail.get("route_key"):
                    route_keys[aid] = detail["route_key"]
                start_hour = 6 if plan.day.weekday() < 5 else 7
                start_local = datetime.combine(
                    plan.day, time(hour=start_hour + s_i * 8 % 12)
                ) + timedelta(minutes=rng.randint(0, 45))

                trimp_val = load_mod.trimp_from_zones(
                    detail["zone_seconds"], settings.hr_rest, settings.hr_max, settings.sex
                )
                today_trimp += trimp_val

                name = session.get("name") or _activity_name(session.get("kind"), sport)
                payload = {
                    "activityId": aid,
                    "activityName": name,
                    "startTimeLocal": start_local.strftime("%Y-%m-%d %H:%M:%S"),
                    "activityType": {"typeKey": sport},
                    "distance": detail["distance_m"],
                    "duration": detail["duration_s"],
                    "movingDuration": detail["moving_time_s"],
                    "averageHR": detail["avg_hr"],
                    "maxHR": detail["max_hr"],
                    "elevationGain": detail["elevation_gain_m"],
                    "calories": detail["calories"],
                    "averageRunningCadenceInStepsPerMinute": detail.get("avg_cadence_spm"),
                    "avgPower": detail.get("avg_power_w"),
                    "_synthetic": True,
                }
                if sport == "strength_training":
                    payload.update(gym_payload(aid, plan.day))
                raw_id = store.store_raw("seed", "activities", aid, payload)
                counts["raw"] += 1

                store.upsert(
                    "activities",
                    ["activity_id"],
                    {
                        "activity_id": aid,
                        "day": plan.day.isoformat(),
                        "start_time_local": start_local.strftime("%Y-%m-%dT%H:%M:%S"),
                        "start_time_utc": (start_local - timedelta(hours=3)).strftime(
                            "%Y-%m-%dT%H:%M:%SZ"
                        ),
                        "activity_type": sport,
                        "activity_name": name,
                        "distance_m": _r(detail["distance_m"]),
                        "duration_s": _r(detail["duration_s"]),
                        "moving_time_s": _r(detail["moving_time_s"]),
                        "avg_hr": _r(detail["avg_hr"], 1),
                        "max_hr": _r(detail["max_hr"], 1),
                        "avg_speed_mps": _r(detail.get("avg_speed_mps"), 3),
                        "max_speed_mps": _r(detail.get("max_speed_mps"), 3),
                        "elevation_gain_m": _r(detail["elevation_gain_m"], 1),
                        "calories": _r(detail["calories"]),
                        "avg_cadence_spm": _r(detail.get("avg_cadence_spm"), 1),
                        "avg_power_w": _r(detail.get("avg_power_w"), 1),
                        "training_effect_aerobic": _r(min(5.0, trimp_val / 28.0), 1),
                        "training_effect_anaerobic": _r(
                            min(5.0, detail["zone_seconds"].get(5, 0) / 240.0), 1
                        ),
                        "trimp": _r(trimp_val, 2),
                        "raw_id": raw_id,
                    },
                )
                counts["activities"] += 1

                for zone, secs in detail["zone_seconds"].items():
                    store.upsert(
                        "activity_hr_zones",
                        ["activity_id", "zone"],
                        {"activity_id": aid, "zone": int(zone), "seconds": round(secs, 1)},
                    )

                # executemany rather than per-row upsert: a three-year seed writes
                # well over a million samples and the round-trips dominate.
                sample_rows = [
                    (
                        aid,
                        el,
                        round(di, 2),
                        round(hr, 1),
                        round(sp, 3),
                        round(cad, 1),
                        None,
                        round(alt, 1),
                        None if pos is None else round(pos[0], 6),
                        None if pos is None else round(pos[1], 6),
                    )
                    for (el, di, hr, sp, cad, alt, pos) in detail["samples"]
                ]
                if sample_rows:
                    store.conn.executemany(
                        "INSERT INTO activity_samples (activity_id, elapsed_s, distance_m, "
                        "hr, speed_mps, cadence_spm, power_w, altitude_m, lat, lon) "
                        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) "
                        "ON CONFLICT (activity_id, elapsed_s) DO NOTHING",
                        sample_rows,
                    )
                    counts["samples"] += len(sample_rows)

            # Fatigue decays, and today's work adds to it.
            state.fatigue = state.fatigue * 0.82 + today_trimp / FATIGUE_DIVISOR

            sleep_row = synth_night(rng, plan.day, state, yesterday_trimp, plan.disrupted)
            wellness_row, hrv_row = synth_wellness(
                rng, plan.day, state, sleep_row, today_trimp, yesterday_trimp,
                plan.disrupted, ran_today,
            )

            for table, keys, row, endpoint in (
                ("sleep", ["day"], sleep_row, "sleep"),
                ("daily_wellness", ["day"], wellness_row, "wellness"),
                ("hrv_daily", ["day"], hrv_row, "hrv"),
            ):
                rid = store.store_raw("seed", endpoint, plan.day.isoformat(), row)
                store.upsert(table, keys, {**row, "raw_id": rid})
                counts["raw"] += 1

            fitness_row = {
                "day": plan.day.isoformat(),
                "vo2max_run": round(state.vo2max + rng.gauss(0, 0.25), 1),
                "vo2max_cycle": round(state.vo2max * 0.94 + rng.gauss(0, 0.3), 1),
                "training_status": _training_status(plan.disrupted, today_trimp, state.fatigue),
                "training_readiness": max(
                    5, min(99, round(58 + 0.28 * (sleep_row["sleep_score"] - 65)
                                     - 0.05 * yesterday_trimp + rng.gauss(0, 7)))
                ),
                "acute_load": None,
                "chronic_load": None,
            }
            rid = store.store_raw("seed", "fitness", plan.day.isoformat(), fitness_row)
            store.upsert("fitness", ["day"], {**fitness_row, "raw_id": rid})
            counts["raw"] += 1

            if steps_on_the_scale(rng, state):
                row = body_row(rng, plan.day, progress_frac, state.weight)
                rid = store.store_raw("seed", "body", plan.day.isoformat(), row)
                store.upsert("body_composition", ["day"], {**row, "raw_id": rid})
                counts["raw"] += 1

            yesterday_trimp = today_trimp
            counts["days"] += 1
            if progress and i % 60 == 0:
                progress(i, total_days)

        for endpoint in ("activities", "sleep", "wellness", "hrv", "fitness", "body"):
            store.set_watermark(endpoint, end.isoformat(), "ok", "synthetic seed")
        store.set_watermark(
            SEED_MARKER_ENDPOINT, end.isoformat(), "ok",
            f"synthetic data, rng_seed={rng_seed}, {start.isoformat()}..{end.isoformat()}",
        )

    counts["best_efforts"] = perf.rebuild_best_efforts(store)

    if gear_data:
        counts["gear"] = seed_gear(store, start, end)
    if cluster:
        if progress:
            progress(total_days, total_days)
        result = routes_mod.cluster_all(store)
        counts["routes"] = result["routes"]
        counts["route_members"] = result.get("created", 0) + result.get("joined", 0)
        counts["named_routes"] = _name_seeded_routes(store, route_keys)
    return counts


def _name_seeded_routes(store, route_keys: dict[str, str]) -> int:
    """Give each clustered route the name of the template that generated it.

    Purely cosmetic, and only possible because the seeder knows the ground truth.
    A real deployment gets generated names ("8.4 km loop #2") until the user renames
    them — this just stops the demo reading like a spreadsheet. Crucially it does
    **not** set `pinned`, so clustering behaviour is identical either way.
    """
    if not route_keys:
        return 0
    named = 0
    for row in store.query("SELECT route_id FROM routes"):
        rid = int(row["route_id"])
        members = store.query(
            "SELECT activity_id FROM route_members WHERE route_id = ?", (rid,)
        )
        keys = [route_keys[m["activity_id"]] for m in members if m["activity_id"] in route_keys]
        if not keys:
            continue
        winner = max(set(keys), key=keys.count)
        template = geo.TEMPLATES_BY_KEY.get(winner)
        if template is None:
            continue
        store.conn.execute(
            "UPDATE routes SET name = ? WHERE route_id = ?", (template.name, rid)
        )
        named += 1
    store.conn.commit()
    return named


# ---------------------------------------------------------------------------
# Gear
# ---------------------------------------------------------------------------

#: Shoes wear out and get replaced; bikes do not. Each shoe covers a date window,
#: which is also the most realistic way to assign gear across imported history — and
#: it exercises exactly the bulk-reassign path the user will need for their own data.
def seed_gear(store, start: date, end: date) -> int:
    """Create a plausible gear cupboard and assign it across the whole history."""
    span = (end - start).days
    made = 0

    # Shoes are consumable, so the rotation is derived from how far the athlete
    # actually ran rather than hardcoded: enough pairs that each retires at roughly
    # its threshold, which is what makes the gear dashboard's percentages mean
    # something. The newest pair is part-worn and still in use.
    threshold_m = 800_000.0
    run_types = ("running", "treadmill_running")  # treadmill miles wear shoes too
    total_run_m = float(
        store.scalar(
            "SELECT COALESCE(SUM(distance_m), 0) FROM activities "
            f"WHERE activity_type IN ({', '.join('?' * len(run_types))})",
            run_types,
        )
        or 0.0
    )
    pairs = max(2, math.ceil(total_run_m / (threshold_m * 0.92)))
    catalogue = [
        ("Asics", "Gel-Nimbus 26", "Nimbus 26"),
        ("Asics", "Novablast 4", "Novablasts"),
        ("Nike", "Pegasus 41", "Pegs"),
        ("Saucony", "Ride 17", "Rides"),
        ("Asics", "Gel-Nimbus 27", "Nimbus 27"),
        ("New Balance", "1080v14", "1080s"),
        ("Hoka", "Clifton 9", "Cliftons"),
        ("Nike", "Vomero 17", "Vomeros"),
    ]
    for i in range(pairs):
        brand, model, nickname = catalogue[i % len(catalogue)]
        if i >= len(catalogue):
            nickname = f"{nickname} ({i // len(catalogue) + 1})"
        lo_day = start + timedelta(days=int(span * i / pairs))
        hi_day = (
            end
            if i == pairs - 1
            else start + timedelta(days=int(span * (i + 1) / pairs) - 1)
        )
        item = gear_mod.create(
            store,
            kind="shoe",
            brand=brand,
            model=model,
            nickname=nickname,
            purchase_date=lo_day.isoformat(),
            retirement_distance_m=threshold_m,
            retired=i < pairs - 1,
        )
        made += 1
        for run_type in run_types:
            gear_mod.bulk_assign(
                store,
                item["gear_id"],
                start=lo_day.isoformat(),
                end=hi_day.isoformat(),
                activity_type=run_type,
            )

    road = gear_mod.create(
        store, kind="bike", brand="Canyon", model="Endurace", nickname="Road bike",
        purchase_date=start.isoformat(), retirement_distance_m=None,
    )
    trainer = gear_mod.create(
        store, kind="bike", brand="Wahoo", model="Kickr Core", nickname="Turbo",
        purchase_date=start.isoformat(),
    )
    made += 2
    gear_mod.bulk_assign(store, road["gear_id"], activity_type="cycling")
    gear_mod.bulk_assign(store, trainer["gear_id"], activity_type="indoor_cycling")

    strap = gear_mod.create(
        store, kind="strap", brand="Garmin", model="HRM-Pro", nickname="Chest strap",
        purchase_date=start.isoformat(), retirement_distance_m=None,
    )
    made += 1
    # The strap only came out for hard sessions, so it does not get every run.
    gear_mod.bulk_assign(
        store, strap["gear_id"], activity_type="running",
        start=(start + timedelta(days=int(span * 0.45))).isoformat(),
    )

    # Default rules: new runs get the current shoes, new rides the road bike.
    current_shoe = store.query(
        "SELECT gear_id FROM gear WHERE kind = 'shoe' AND retired = 0 ORDER BY gear_id DESC LIMIT 1"
    )
    if current_shoe:
        gear_mod.set_default(store, "running", int(current_shoe[0]["gear_id"]))
    gear_mod.set_default(store, "cycling", road["gear_id"])
    return made


def is_synthetic(store) -> bool:
    return store.get_watermark(SEED_MARKER_ENDPOINT) is not None


def _r(v, nd: int = 1):
    return None if v is None else round(float(v), nd)


def _activity_name(kind: str | None, sport: str) -> str:
    if sport == "treadmill_running":
        return "Treadmill run"
    if sport != "running":
        return {"cycling": "Ride", "indoor_cycling": "Turbo session",
                "swimming": "Pool swim",
                "strength_training": "Strength"}.get(sport, sport.title())
    return {
        "easy": "Easy run",
        "long": "Long run",
        "tempo": "Tempo run",
        "intervals": "Interval session",
        "recovery": "Recovery run",
        "race": "Race effort",
    }.get(kind or "", "Run")


def _training_status(disrupted: str | None, today_trimp: float, fatigue: float) -> str:
    if disrupted == "illness":
        return "UNPRODUCTIVE"
    if disrupted == "travel":
        return "DETRAINING"
    if fatigue > 0.85:
        return "OVERREACHING"
    if today_trimp > 90:
        return "PRODUCTIVE"
    if today_trimp > 0:
        return "MAINTAINING"
    return "RECOVERY"
