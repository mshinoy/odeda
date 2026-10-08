"""Paths and settings.

Everything is overridable by environment variable so tests and the seeder can
run against a scratch database without touching the real one.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import date
from pathlib import Path

# --- The thing we are training for -------------------------------------------------
# Doha Marathon by Ooredoo, half marathon, Friday 15 January 2027, 07:35 local start.
RACE_NAME = "Doha Marathon by Ooredoo — Half Marathon"
RACE_DATE = date(2027, 1, 15)
RACE_START_LOCAL = "07:35"
RACE_DISTANCE_M = 21097.5
RACE_TIMEZONE = "Asia/Qatar"

# --- Athlete defaults ---------------------------------------------------------------
# Used by TRIMP and zone maths until real values are read from the Garmin profile.
# Override with GA_HR_REST / GA_HR_MAX / GA_SEX.
DEFAULT_HR_REST = 52
DEFAULT_HR_MAX = 187
DEFAULT_SEX = "male"  # only affects the Banister TRIMP exponent

# --- Training-plan targets used by the race panel ------------------------------------
TARGET_PEAK_CTL = 75.0
TARGET_PEAK_WEEKLY_KM = 55.0


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
    )
