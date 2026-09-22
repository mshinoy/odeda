"""FastAPI app: JSON endpoints plus the static dashboard.

A fresh `Store` (and therefore a fresh sqlite3 connection) is opened per request.
sqlite3 connections are not safe to share across threads, and opening one is
microseconds; a connection pool here would be complexity bought for nothing.

Read-heavy analytics (performance, reports) are memoised behind a short TTL keyed on
the database's modification time, so a re-sync invalidates the cache without anyone
having to remember to clear it.
"""

from __future__ import annotations

import time
from datetime import date, datetime
from typing import Any, Callable

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .. import __version__, config
from ..analytics import load as load_mod
from ..analytics import performance as perf
from ..analytics import readiness as ready_mod
from ..analytics import reports as reports_mod
from ..analytics import trends as trends_mod
from ..config import Settings, load_settings
from ..db.store import Store
from ..ingest import connect as connect_mod
from ..seed import synthetic

CACHE_TTL_S = 30.0
_cache: dict[str, tuple[float, float, Any]] = {}


def _db_mtime(settings: Settings) -> float:
    try:
        return settings.db_path.stat().st_mtime
    except OSError:
        return 0.0


def cached(settings: Settings, key: str, fn: Callable[[], Any]) -> Any:
    """Memoise on (cache key, database mtime). A sync bumps mtime and invalidates."""
    mtime = _db_mtime(settings)
    hit = _cache.get(key)
    now = time.time()
    if hit and hit[0] == mtime and now - hit[1] < CACHE_TTL_S:
        return hit[2]
    value = fn()
    _cache[key] = (mtime, now, value)
    return value


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or load_settings()
    settings.ensure_dirs()

    app = FastAPI(
        title="Garmin Analytics",
        version=__version__,
        description="Personal analytics over Garmin Connect data. Local only.",
    )

    def store() -> Store:
        return Store.open(settings)

    # -- meta ----------------------------------------------------------------

    @app.get("/api/health")
    def health() -> dict[str, Any]:
        with store() as st:
            lo, hi = st.day_range()
            return {
                "status": "ok",
                "version": __version__,
                "db": str(settings.db_path),
                "day_range": {"from": lo, "to": hi},
                "synthetic": synthetic.is_synthetic(st),
                "server_time": datetime.now().isoformat(timespec="seconds"),
            }

    @app.get("/api/doctor")
    def doctor() -> dict[str, Any]:
        from ..diagnostics import run_doctor

        return run_doctor(settings)

    @app.get("/api/summary")
    def summary() -> dict[str, Any]:
        """Everything the Overview tab needs, in one round trip."""
        with store() as st:
            lo, hi = st.day_range()
            ld = cached(settings, "load", lambda: load_mod.compute_load(st))
            rd = ready_mod.compute_readiness(st)
            tr = cached(settings, "trends", lambda: trends_mod.compute_trends(st, days=180))
            rep = cached(settings, "reports", lambda: reports_mod.compute_reports(st))
            race = ready_mod.compute_race(st)
            latest = st.query("SELECT * FROM v_daily ORDER BY day DESC LIMIT 1")
            return {
                "day_range": {"from": lo, "to": hi},
                "synthetic": synthetic.is_synthetic(st),
                "latest_day": latest[0] if latest else None,
                "readiness": rd,
                "load": ld.get("current"),
                "ramp_pct": ld.get("ramp_pct"),
                "ramp_flag": ld.get("ramp_flag"),
                "warmup_note": ld.get("warmup_note"),
                "flags": tr.get("flags"),
                "totals": rep.get("totals"),
                "streaks": rep.get("streaks"),
                "race": {
                    "name": race["race"]["name"],
                    "date": race["race"]["date"],
                    "days_to_go": race["days_to_go"],
                    "projection": race["projection"],
                },
                "recent_weeks": rep.get("weekly", [])[-8:],
            }

    # -- analytics -----------------------------------------------------------

    @app.get("/api/load")
    def api_load(
        start: str | None = Query(None, description="ISO date"),
        end: str | None = Query(None, description="ISO date"),
    ) -> dict[str, Any]:
        with store() as st:
            if start or end:
                return load_mod.compute_load(st, start, end)
            return cached(settings, "load", lambda: load_mod.compute_load(st))

    @app.get("/api/trends")
    def api_trends(
        days: int = Query(180, ge=7, le=2000),
        metrics: str | None = Query(None, description="comma-separated metric names"),
    ) -> dict[str, Any]:
        wanted = [m.strip() for m in metrics.split(",")] if metrics else None
        if wanted:
            unknown = [m for m in wanted if m not in trends_mod.TREND_METRICS]
            if unknown:
                raise HTTPException(400, f"unknown metrics: {', '.join(unknown)}")
        with store() as st:
            return trends_mod.compute_trends(st, days=days, metrics=wanted)

    @app.get("/api/readiness")
    def api_readiness(day: str | None = None) -> dict[str, Any]:
        with store() as st:
            return ready_mod.compute_readiness(st, day)

    @app.get("/api/readiness/history")
    def api_readiness_history(days: int = Query(90, ge=7, le=800)) -> dict[str, Any]:
        with store() as st:
            return {"days": days, "series": ready_mod.readiness_history(st, days)}

    @app.get("/api/performance")
    def api_performance() -> dict[str, Any]:
        with store() as st:
            return cached(settings, "performance", lambda: perf.compute_performance(st))

    @app.get("/api/race")
    def api_race() -> dict[str, Any]:
        with store() as st:
            return ready_mod.compute_race(st)

    @app.get("/api/reports")
    def api_reports() -> dict[str, Any]:
        with store() as st:
            return cached(settings, "reports", lambda: reports_mod.compute_reports(st))

    @app.get("/api/daily")
    def api_daily(days: int = Query(400, ge=1, le=3000)) -> dict[str, Any]:
        with store() as st:
            rows = st.query("SELECT * FROM v_daily ORDER BY day")
            return {"days": len(rows[-days:]), "rows": rows[-days:]}

    # -- activities ----------------------------------------------------------

    SORTABLE = {
        "day", "distance_m", "duration_s", "moving_time_s", "avg_hr", "max_hr",
        "avg_speed_mps", "elevation_gain_m", "calories", "trimp", "activity_type",
    }

    @app.get("/api/activities")
    def api_activities(
        limit: int = Query(50, ge=1, le=1000),
        offset: int = Query(0, ge=0),
        type: str | None = None,
        start: str | None = None,
        end: str | None = None,
        q: str | None = None,
        sort: str = Query("day"),
        order: str = Query("desc", pattern="^(asc|desc)$"),
    ) -> dict[str, Any]:
        if sort not in SORTABLE:
            raise HTTPException(400, f"cannot sort by {sort!r}; allowed: {sorted(SORTABLE)}")
        where: list[str] = []
        params: list[Any] = []
        if type:
            where.append("activity_type = ?")
            params.append(type)
        if start:
            where.append("day >= ?")
            params.append(start)
        if end:
            where.append("day <= ?")
            params.append(end)
        if q:
            where.append("activity_name LIKE ?")
            params.append(f"%{q}%")
        clause = (" WHERE " + " AND ".join(where)) if where else ""

        with store() as st:
            total = st.scalar(f"SELECT COUNT(*) FROM activities{clause}", params)
            rows = st.query(
                f"SELECT * FROM activities{clause} "
                f"ORDER BY {sort} {order.upper()}, activity_id DESC LIMIT ? OFFSET ?",
                [*params, limit, offset],
            )
            types = [
                r["activity_type"]
                for r in st.query(
                    "SELECT activity_type, COUNT(*) n FROM activities "
                    "GROUP BY activity_type ORDER BY n DESC"
                )
            ]
            return {"total": total, "limit": limit, "offset": offset, "types": types, "rows": rows}

    @app.get("/api/activities/{activity_id}")
    def api_activity(activity_id: str, samples: bool = True) -> dict[str, Any]:
        with store() as st:
            rows = st.query("SELECT * FROM activities WHERE activity_id = ?", (activity_id,))
            if not rows:
                raise HTTPException(404, f"no activity {activity_id!r}")
            act = rows[0]
            zones = st.query(
                "SELECT zone, seconds FROM activity_hr_zones WHERE activity_id = ? ORDER BY zone",
                (activity_id,),
            )
            bests = st.query(
                "SELECT distance_m, seconds FROM best_efforts WHERE activity_id = ? "
                "ORDER BY distance_m",
                (activity_id,),
            )
            sample_rows = (
                st.query(
                    "SELECT elapsed_s, distance_m, hr, speed_mps, cadence_spm, altitude_m "
                    "FROM activity_samples WHERE activity_id = ? ORDER BY elapsed_s",
                    (activity_id,),
                )
                if samples
                else []
            )
            dec = None
            ef = None
            if sample_rows:
                dec = perf.aerobic_decoupling(
                    [float(r["elapsed_s"]) for r in sample_rows],
                    [float(r["distance_m"] or 0) for r in sample_rows],
                    [r["hr"] for r in sample_rows],
                )
                ef = perf.efficiency_factor(
                    float(act["distance_m"] or 0),
                    float(act["moving_time_s"] or 0),
                    float(act["avg_hr"] or 0),
                )
            return {
                "activity": act,
                "hr_zones": zones,
                "best_efforts": [
                    {
                        **b,
                        "label": perf.DISTANCE_LABELS.get(b["distance_m"]),
                        "time": perf.hms(float(b["seconds"])),
                        "pace": perf.pace_str(
                            float(b["seconds"]) / (float(b["distance_m"]) / 1000.0)
                        ),
                    }
                    for b in bests
                ],
                "decoupling_pct": None if dec is None else round(dec, 2),
                "efficiency_factor": None if ef is None else round(ef, 3),
                "km_splits": _splits(sample_rows),
                "samples": sample_rows,
            }

    @app.get("/api/raw/{endpoint}/{ref_key}")
    def api_raw(endpoint: str, ref_key: str) -> JSONResponse:
        """The verbatim archived payload. Proves raw-first ingestion actually kept it."""
        with store() as st:
            rows = st.query(
                "SELECT source, endpoint, ref_key, fetched_at, payload FROM raw_documents "
                "WHERE endpoint = ? AND ref_key = ? ORDER BY id DESC LIMIT 1",
                (endpoint, ref_key),
            )
            if not rows:
                raise HTTPException(404, f"no raw document for {endpoint}/{ref_key}")
            import json

            row = rows[0]
            return JSONResponse(
                {
                    "source": row["source"],
                    "endpoint": row["endpoint"],
                    "ref_key": row["ref_key"],
                    "fetched_at": row["fetched_at"],
                    "payload": json.loads(row["payload"]),
                }
            )

    @app.get("/api/config")
    def api_config() -> dict[str, Any]:
        """Non-secret configuration, so the dashboard can label its own assumptions."""
        return {
            "race": {
                "name": config.RACE_NAME,
                "date": config.RACE_DATE.isoformat(),
                "start_local": config.RACE_START_LOCAL,
                "timezone": config.RACE_TIMEZONE,
            },
            "athlete": {"hr_rest": settings.hr_rest, "hr_max": settings.hr_max, "sex": settings.sex},
            "targets": {
                "peak_ctl": config.TARGET_PEAK_CTL,
                "peak_weekly_km": config.TARGET_PEAK_WEEKLY_KM,
            },
            "version": __version__,
        }

    # -- static dashboard ----------------------------------------------------

    web = settings.web_dir
    if web.is_dir():
        app.mount("/static", StaticFiles(directory=str(web)), name="static")

        @app.get("/")
        def index() -> FileResponse:
            return FileResponse(str(web / "index.html"))

    return app


def _splits(samples: list[dict[str, Any]], split_m: float = 1000.0) -> list[dict[str, Any]]:
    """Per-kilometre splits from a sample stream."""
    if len(samples) < 2:
        return []
    out: list[dict[str, Any]] = []
    target = split_m
    prev_t = float(samples[0]["elapsed_s"])
    hr_bucket: list[float] = []
    for s in samples:
        if s.get("hr") is not None:
            hr_bucket.append(float(s["hr"]))
        d = s.get("distance_m")
        if d is None:
            continue
        if float(d) >= target:
            t = float(s["elapsed_s"])
            secs = t - prev_t
            out.append(
                {
                    "km": int(target / 1000),
                    "seconds": round(secs, 1),
                    "pace": perf.pace_str(secs / (split_m / 1000.0)) if secs > 0 else None,
                    "avg_hr": round(sum(hr_bucket) / len(hr_bucket), 1) if hr_bucket else None,
                }
            )
            prev_t = t
            hr_bucket = []
            target += split_m
    return out
