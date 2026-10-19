"""Paths and settings.

Everything is overridable by environment variable so tests and the seeder can
run against a scratch database without touching the real one.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

# --- The thing we are training for -------------------------------------------------
# The race is NOT here. It comes from the training calendar: a session the parser reads
# as `kind='race'` carries the name, day, start time and distance, and `analytics.plan
# .goal_race` picks the nearest one still to come (T57). Four constants used to hold
# the same facts and went stale the day the race was run — the same reason D12 deleted
# `TARGET_PEAK_CTL`. Add a race by putting it in the calendar.
#
# The timezone stays: it is where the owner trains, not a fact about any one race, and
# the ICS parser needs it before there are any sessions to read a race out of.
RACE_TIMEZONE = "Asia/Qatar"

# --- Athlete defaults ---------------------------------------------------------------
# Used by TRIMP and zone maths until real values are read from the Garmin profile.
# Override with GA_HR_REST / GA_HR_MAX / GA_SEX.
DEFAULT_HR_REST = 52
DEFAULT_HR_MAX = 187
DEFAULT_SEX = "male"  # only affects the Banister TRIMP exponent

# There are deliberately no training targets here. `TARGET_PEAK_CTL = 75` and
# `TARGET_PEAK_WEEKLY_KM = 55` used to live at this spot and were invented by an agent,
# against a plan that never asks for more than 36 km in a week — so the race panel
# warned "a long way short" on weeks the owner had followed exactly. The targets now
# come from the subscribed calendar (`analytics/plan.race_targets`), and with no
# calendar there are none (D12).


def _env_path(name: str, default: Path) -> Path:
    raw = os.environ.get(name)
    return Path(raw).expanduser() if raw else default


def _xdg_data_home() -> Path:
    return _env_path("XDG_DATA_HOME", Path.home() / ".local" / "share")


def _env_bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")


@dataclass(frozen=True)
class Settings:
    data_dir: Path
    db_path: Path
    raw_archive_dir: Path
    token_dir: Path
    hr_rest: int
    hr_max: int
    sex: str
    #: Read once at startup, hashed into the database, then discarded. Empty means
    #: the app runs unprotected — fine on a laptop, not fine on a public port.
    app_password: str = ""
    #: Set GA_COOKIE_SECURE=1 when serving over HTTPS (behind a reverse proxy).
    cookie_secure: bool = False
    session_ttl_days: int = 30
    #: Hours between automatic syncs (D8). 0 turns them off. Off unless set, so a
    #: Settings built anywhere but `load_settings` never starts a scheduler by accident.
    auto_sync_hours: float = 0.0
    #: Recompute the Map's heatmap in the background after the data changes, so the
    #: first visit finds it ready (`api/cache.py`). Off unless set, like auto-sync;
    #: `GA_CACHE_WARM=0` turns it off.
    cache_warm: bool = False
    #: The training calendar's secret iCal address, for deployments that would rather
    #: declare it than paste it into Settings. A **bootstrap default only**: it is
    #: adopted when nothing is subscribed yet, and from then on the database wins. The
    #: alternative — env always winning — means a change made in Settings silently
    #: reverts on the next restart, which is worse than having to edit one file.
    plan_ics_url: str = ""
    #: Where the React SPA's production build lands (`npm run build` in frontend/).
    #: A build artifact, not source: absent in a fresh clone, and the API runs without it.
    ui_dir: Path = Path(__file__).resolve().parent / "ui"

    @property
    def schema_path(self) -> Path:
        return Path(__file__).resolve().parent / "db" / "schema.sql"

    def ensure_dirs(self) -> None:
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.raw_archive_dir.mkdir(parents=True, exist_ok=True)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)


def load_settings() -> Settings:
    data_dir = _env_path("GA_DATA_DIR", _xdg_data_home() / "garmin-analytics")
    db_path = _env_path("GA_DB", data_dir / "garmin.db")
    return Settings(
        data_dir=data_dir,
        db_path=db_path,
        raw_archive_dir=_env_path("GA_RAW_DIR", data_dir / "raw_archive"),
        # garminconnect's own default; it writes garmin_tokens.json here, 0600
        # inside a 0700 directory.
        token_dir=_env_path("GA_TOKEN_DIR", Path.home() / ".garminconnect"),
        hr_rest=int(os.environ.get("GA_HR_REST", DEFAULT_HR_REST)),
        hr_max=int(os.environ.get("GA_HR_MAX", DEFAULT_HR_MAX)),
        sex=os.environ.get("GA_SEX", DEFAULT_SEX).lower(),
        app_password=os.environ.get("APP_PASSWORD", "").strip(),
        cookie_secure=_env_bool("GA_COOKIE_SECURE", False),
        session_ttl_days=int(os.environ.get("GA_SESSION_DAYS", 30)),
        auto_sync_hours=float(os.environ.get("GA_AUTO_SYNC_HOURS", 6)),
        cache_warm=os.environ.get("GA_CACHE_WARM", "1") != "0",
        plan_ics_url=os.environ.get("GA_PLAN_ICS_URL", "").strip(),
    )
