"""`doctor`: report environment status honestly.

Every check returns ok / warn / fail plus a one-line detail. Nothing here ever prints
a token, a cookie or a credential — token checks report presence and file mode only.
"""

from __future__ import annotations

import importlib
import os
import shutil
import sqlite3
import sys
from pathlib import Path
from typing import Any

from . import __version__
from .config import Settings, load_settings

REQUIRED_MODULES = ["garth", "fitdecode", "fastapi", "uvicorn"]
OPTIONAL_MODULES = ["pytest", "httpx"]


def _check(name: str, status: str, detail: str, **extra: Any) -> dict[str, Any]:
    return {"check": name, "status": status, "detail": detail, **extra}


def check_python() -> dict[str, Any]:
    v = sys.version_info
    ok = (v.major, v.minor) >= (3, 11)
    return _check(
        "python",
        "ok" if ok else "fail",
        f"{v.major}.{v.minor}.{v.micro} at {sys.executable}",
    )


def check_venv() -> dict[str, Any]:
    in_venv = sys.prefix != getattr(sys, "base_prefix", sys.prefix)
    return _check(
        "venv",
        "ok" if in_venv else "warn",
        f"running inside {sys.prefix}" if in_venv else
        "not running inside a virtualenv — dependency versions are whatever is global",
    )


def check_dependencies() -> list[dict[str, Any]]:
    out = []
    for mod in REQUIRED_MODULES + OPTIONAL_MODULES:
        required = mod in REQUIRED_MODULES
        try:
            m = importlib.import_module(mod)
            version = getattr(m, "__version__", None) or getattr(
                getattr(m, "version", None), "__version__", "?"
            )
            note = ""
            if mod == "garth":
                note = " (deprecated upstream; see DECISIONS.md D3)"
            out.append(_check(f"dep:{mod}", "ok", f"{version}{note}"))
        except ImportError:
            out.append(
                _check(
                    f"dep:{mod}",
                    "fail" if required else "warn",
                    "not installed" + ("" if required else " (test-only)"),
                )
            )
    return out


def check_database(settings: Settings) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    path = settings.db_path
    if not path.exists():
        return [
            _check(
                "database",
                "warn",
                f"{path} does not exist yet — run `garmin-analytics seed` or `sync`",
            )
        ]
    size_mb = path.stat().st_size / 1e6
    out.append(_check("database", "ok", f"{path} ({size_mb:.1f} MB)"))

    try:
        conn = sqlite3.connect(str(path))
        conn.row_factory = sqlite3.Row
        version = conn.execute("SELECT MAX(version) v FROM schema_migrations").fetchone()["v"]
        out.append(_check("schema", "ok" if version else "warn", f"version {version}"))

        counts = {}
        for table in ("activities", "daily_wellness", "sleep", "hrv_daily", "raw_documents"):
            try:
                counts[table] = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            except sqlite3.Error:
                counts[table] = None
        empty = [t for t, n in counts.items() if not n]
        out.append(
            _check(
                "tables",
                "ok" if not empty else "warn",
                ", ".join(f"{t}={n}" for t, n in counts.items())
                + (f" — empty: {', '.join(empty)}" if empty else ""),
                counts=counts,
            )
        )

        rng = conn.execute("SELECT MIN(day) lo, MAX(day) hi FROM daily_wellness").fetchone()
        if rng and rng["lo"]:
            out.append(_check("date range", "ok", f"{rng['lo']} .. {rng['hi']}"))
        else:
            out.append(_check("date range", "warn", "no daily wellness rows"))

        marker = conn.execute(
            "SELECT note FROM sync_watermark WHERE endpoint = 'seed:synthetic'"
        ).fetchone()
        if marker:
            out.append(
                _check(
                    "data provenance",
                    "warn",
                    f"SYNTHETIC data — {marker['note']}. Not your real training.",
                    synthetic=True,
                )
            )
        else:
            out.append(_check("data provenance", "ok", "no synthetic-seed marker", synthetic=False))

        marks = conn.execute(
            "SELECT endpoint, last_day, status, last_run_at FROM sync_watermark "
            "WHERE endpoint != 'seed:synthetic' ORDER BY endpoint"
        ).fetchall()
        out.append(
            _check(
                "watermarks",
                "ok" if marks else "warn",
                "; ".join(f"{m['endpoint']}→{m['last_day']}" for m in marks) or "none recorded",
                watermarks=[dict(m) for m in marks],
            )
        )
        conn.close()
    except sqlite3.Error as exc:
        out.append(_check("schema", "fail", f"cannot read database: {exc}"))
    return out


def check_tokens(settings: Settings) -> dict[str, Any]:
    """Presence and permissions only. The token contents are never read or printed."""
    d = settings.token_dir
    if not d.exists():
        return _check(
            "garmin auth",
            "warn",
            f"no token cache at {d} — run `garmin-analytics login` "
            "(synthetic data works without it)",
            authenticated=False,
        )
    files = sorted(p.name for p in d.glob("*token*.json"))
    if not files:
        return _check("garmin auth", "warn", f"{d} exists but holds no token files",
                      authenticated=False)
    modes = {p.name: oct(p.stat().st_mode & 0o777) for p in d.glob("*token*.json")}
    loose = [n for n, m in modes.items() if m not in ("0o600", "0o400")]
    return _check(
        "garmin auth",
        "ok" if not loose else "warn",
        f"token cache present ({', '.join(files)}), modes {modes}"
        + (f" — these should be 0600: {', '.join(loose)}" if loose else ""),
        authenticated=True,
    )


def check_web(settings: Settings) -> dict[str, Any]:
    web = settings.web_dir
    needed = ["index.html", "app.js", "style.css", "vendor/uPlot.iife.min.js", "vendor/uPlot.min.css"]
    missing = [n for n in needed if not (web / n).exists()]
    return _check(
        "dashboard assets",
        "ok" if not missing else "fail",
        f"{web}" + (f" — missing: {', '.join(missing)}" if missing else " (all present, no CDN)"),
    )


def check_disk(settings: Settings) -> dict[str, Any]:
    usage = shutil.disk_usage(settings.data_dir if settings.data_dir.exists() else Path.home())
    free_gb = usage.free / 1e9
    pct = usage.used / usage.total * 100
    status = "ok" if free_gb > 1.0 else ("warn" if free_gb > 0.3 else "fail")
    return _check("disk", status, f"{free_gb:.1f} GB free ({pct:.0f}% used)")


def run_doctor(settings: Settings | None = None) -> dict[str, Any]:
    settings = settings or load_settings()
    checks: list[dict[str, Any]] = [check_python(), check_venv()]
    checks += check_dependencies()
    checks.append(check_disk(settings))
    checks += check_database(settings)
    checks.append(check_tokens(settings))
    checks.append(check_web(settings))

    worst = "ok"
    for c in checks:
        if c["status"] == "fail":
            worst = "fail"
            break
        if c["status"] == "warn":
            worst = "warn"
    return {
        "version": __version__,
        "overall": worst,
        "checks": checks,
        "paths": {
            "data_dir": str(settings.data_dir),
            "db": str(settings.db_path),
            "token_dir": str(settings.token_dir),
            "web": str(settings.web_dir),
        },
    }
