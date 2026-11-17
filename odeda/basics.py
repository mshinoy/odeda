"""The basics a new person has to set: time zone and heart-rate limits.

They used to be environment variables only (`TZ`, `GA_HR_REST`, `GA_HR_MAX`), which meant
editing `.env` before the first start, with a wrong value showing up only later: heart rate
drives every training-load number and the time zone decides what "today" is.

Now they can also be set in Settings. A saved value lives in `app_settings` and wins; with
nothing saved the environment value (or the built-in default) is used. The same reasoning as
the calendar address applies: the environment is the starting default, and a change made in
Settings must not revert on the next restart.
"""

from __future__ import annotations

import os
import time
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from .config import env_athlete

KEY_TZ = "basics.timezone"
KEY_REST = "basics.hr_rest"
KEY_MAX = "basics.hr_max"

#: Plausible bounds. They stop a typo ("1870") from silently zeroing every load number;
#: they are not medical limits.
REST_RANGE = (30, 100)
MAX_RANGE = (120, 230)
#: Heart-rate reserve below this makes TRIMP divide by something close to zero.
MIN_RESERVE = 40

# What the process was started with, captured once so the page can show "default: X".
_ENV_TZ = os.environ.get("TZ") or "Etc/UTC"


def default_timezone() -> str:
    return _ENV_TZ


def current_timezone() -> str:
    return os.environ.get("TZ") or _ENV_TZ


def validate_timezone(name: str) -> str:
    name = (name or "").strip()
    if not name:
        raise ValueError("time zone cannot be empty")
    try:
        ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError, OSError) as exc:
        raise ValueError(f"unknown time zone: {name}") from exc
    return name


def validate_heart_rate(rest: int, maximum: int) -> tuple[int, int]:
    lo, hi = REST_RANGE
    if not lo <= rest <= hi:
        raise ValueError(f"resting heart rate must be between {lo} and {hi}")
    lo, hi = MAX_RANGE
    if not lo <= maximum <= hi:
        raise ValueError(f"maximum heart rate must be between {lo} and {hi}")
    if maximum - rest < MIN_RESERVE:
        raise ValueError(
            f"maximum must be at least {MIN_RESERVE} above resting, or the load maths breaks"
        )
    return rest, maximum


def _use_timezone(name: str) -> None:
    """Make "today" in this process mean today there. `time.tzset` is POSIX only, which
    is every place the container runs."""
    os.environ["TZ"] = name
    if hasattr(time, "tzset"):
        time.tzset()


def apply_saved(store, settings) -> None:
    """At startup: put the saved values in force. Quiet about anything unusable, so a
    bad row never stops the app from starting."""
    tz = store.get_setting(KEY_TZ)
    if tz:
        try:
            _use_timezone(validate_timezone(tz))
        except ValueError:
            pass
    rest, maximum = store.get_setting(KEY_REST), store.get_setting(KEY_MAX)
    if rest and maximum:
        try:
            settings.override_athlete(*validate_heart_rate(int(rest), int(maximum)))
        except ValueError:
            pass


def read(store, settings) -> dict[str, Any]:
    """What Settings shows: the value in force, whether it was saved, and the default."""
    return {
        "timezone": current_timezone(),
        "timezone_default": default_timezone(),
        "hr_rest": settings.hr_rest,
        "hr_max": settings.hr_max,
        # The environment's values, for "back to the defaults"; `settings.hr_*` may
        # already be overridden.
        "hr_rest_default": env_athlete()[0],
        "hr_max_default": env_athlete()[1],
        "saved": bool(
            store.get_setting(KEY_TZ)
            or (store.get_setting(KEY_REST) and store.get_setting(KEY_MAX))
        ),
    }


def save(store, settings, timezone: str, hr_rest: int, hr_max: int) -> dict[str, Any]:
    """Validate, store and apply. Returns what changed in training load, so the caller
    can say that the numbers moved and clear its caches."""
    tz = validate_timezone(timezone)
    rest, maximum = validate_heart_rate(int(hr_rest), int(hr_max))
    heart_changed = (rest, maximum) != (settings.hr_rest, settings.hr_max)
    store.set_setting(KEY_TZ, tz)
    store.set_setting(KEY_REST, str(rest))
    store.set_setting(KEY_MAX, str(maximum))
    _use_timezone(tz)
    settings.override_athlete(rest, maximum)
    recomputed = 0
    if heart_changed:
        from .analytics import load as load_mod

        recomputed = load_mod.recompute_trimp(store)
    return {**read(store, settings), "recomputed": recomputed}
