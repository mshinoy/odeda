"""FastAPI app: JSON endpoints, the session gate, and the static dashboard.

A fresh `Store` (and therefore a fresh sqlite3 connection) is opened per request.
sqlite3 connections are not safe to share across threads, and opening one is
microseconds; a connection pool here would be complexity bought for nothing.

Read-heavy analytics (performance, reports, aggregates) are memoised behind a short
TTL keyed on the database's modification time, so a re-sync invalidates the cache
without anyone having to remember to clear it.

Everything that reads activities reads `v_activities` (or `v_activities_included`
for statistics), never the `activities` table — that is what makes user edits show
up everywhere at once.
"""

from __future__ import annotations

import asyncio
import json
import threading
import time
from datetime import date, datetime
from typing import Any, Callable

from fastapi import Body, Depends, FastAPI, HTTPException, Query, Request, Response
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from .. import __version__, config
from ..analytics import aggregate as agg_mod
from ..analytics import load as load_mod
from ..analytics import performance as perf
from ..analytics import readiness as ready_mod
from ..analytics import reports as reports_mod
from ..analytics import routes as routes_mod
from ..analytics import trends as trends_mod
from ..config import Settings, load_settings
from ..db import fields as fields_mod
from ..db.store import Store
from ..edits import gear as gear_mod
from ..edits import overrides as ov_mod
from ..ingest import backfill as backfill_mod
from ..seed import synthetic
from . import auth as auth_mod

CACHE_TTL_S = 30.0
_cache: dict[str, tuple[float, float, Any]] = {}

#: Paths reachable without a session. Everything else is gated when a password is set.
PUBLIC_PREFIXES = ("/static/", "/api/health", "/api/auth/", "/login", "/favicon")


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


class BackgroundJob:
    """A single long-running job (the backfill), run in a worker thread.

    Single-tenant means at most one of these matters at a time, so this is a plain
    thread and a stop flag rather than a task queue. Durable progress lives in the
    `sync_status` table, not here: if the process dies mid-backfill, the next start
    resumes from the database, not from anything held in memory.
    """

    def __init__(self) -> None:
        self.thread: threading.Thread | None = None
        self._stop = threading.Event()
        self.last_error: str | None = None

    @property
    def running(self) -> bool:
        return self.thread is not None and self.thread.is_alive()

    def start(self, target: Callable[[Callable[[], bool]], None]) -> None:
        if self.running:
            raise RuntimeError("a sync is already running")
        self._stop.clear()
        self.last_error = None

        def runner() -> None:
            try:
                target(self._stop.is_set)
            except Exception as exc:  # recorded, not raised into a dead thread
                self.last_error = f"{type(exc).__name__}: {exc}"

        self.thread = threading.Thread(target=runner, name="ga-backfill", daemon=True)
        self.thread.start()

    def stop(self) -> bool:
        if not self.running:
            return False
        self._stop.set()
        return True


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or load_settings()
    settings.ensure_dirs()

    app = FastAPI(
        title="Garmin Analytics",
        version=__version__,
        description="Self-hosted analytics over your own Garmin Connect history.",
    )
    job = BackgroundJob()
    app.state.job = job

    def store() -> Store:
        return Store.open(settings)

    # Reconcile APP_PASSWORD with the stored hash once, at startup.
    with store() as st:
        app.state.password_state = auth_mod.sync_password_from_env(st, settings.app_password)
        app.state.auth_required = auth_mod.auth_required(st)

    # -- auth gate -----------------------------------------------------------

    @app.middleware("http")
    async def require_session(request: Request, call_next):
        """Gate everything except the login screen and its assets.

        No password configured means no gate at all — running unprotected on a
        laptop is a legitimate choice, and pretending otherwise would just make
        people set APP_PASSWORD=x.
        """
        path = request.url.path
        if not app.state.auth_required or path.startswith(PUBLIC_PREFIXES):
            return await call_next(request)

        token = request.cookies.get(auth_mod.COOKIE_NAME)
        with store() as st:
            ok = auth_mod.session_valid(st, token)
        if ok:
            return await call_next(request)
        if path.startswith("/api/"):
            return JSONResponse({"detail": "authentication required"}, status_code=401)
        return RedirectResponse("/login", status_code=302)

    def _set_cookie(response: Response, token: str) -> None:
        response.set_cookie(
            auth_mod.COOKIE_NAME,
            token,
            max_age=settings.session_ttl_days * 86400,
            httponly=True,
            samesite="lax",
            secure=settings.cookie_secure,
            path="/",
        )

    @app.get("/api/auth/status")
    def auth_status(request: Request) -> dict[str, Any]:
        with store() as st:
            token = request.cookies.get(auth_mod.COOKIE_NAME)
            return {
                "auth_required": app.state.auth_required,
                "authenticated": (not app.state.auth_required)
                or auth_mod.session_valid(st, token),
                "password_state": app.state.password_state,
                "garmin": auth_mod.garmin_status(settings),
            }

    @app.post("/api/auth/login")
    def auth_login(response: Response, payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
        if not app.state.auth_required:
            return {"status": "ok", "auth_required": False}
        with store() as st:
            if not auth_mod.verify_password(st, str(payload.get("password") or "")):
                # One deliberate second of delay: this endpoint is the only thing
                # between the internet and the data, and there is exactly one
                # password to guess.
                time.sleep(1.0)
                raise HTTPException(401, "wrong password")
            token = auth_mod.create_session(st, settings.session_ttl_days, "web")
        _set_cookie(response, token)
        return {"status": "ok"}

    @app.post("/api/auth/logout")
    def auth_logout(request: Request, response: Response) -> dict[str, Any]:
        with store() as st:
            auth_mod.destroy_session(st, request.cookies.get(auth_mod.COOKIE_NAME))
        response.delete_cookie(auth_mod.COOKIE_NAME, path="/")
        return {"status": "ok"}

    # -- Garmin connection (the first-run setup screen) ----------------------

    @app.get("/api/garmin/status")
    def garmin_status() -> dict[str, Any]:
        return auth_mod.garmin_status(settings)

    @app.post("/api/garmin/login")
    def garmin_login(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
        """Exchange Garmin credentials for a token cache. Credentials are not stored."""
        try:
            return auth_mod.garmin_login(
                settings,
                str(payload.get("email") or "").strip(),
                str(payload.get("password") or ""),
            )
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
        except Exception as exc:
            # Garmin retired the endpoint this path posts to; it answers 429 for every
            # account, valid or invented. Say so, instead of leaving the user retyping
            # a password that was never the problem (matin/garth#222).
            if "429" in str(exc):
                raise HTTPException(
                    503,
                    "Garmin has retired the password login this uses — it now returns "
                    "429 for everyone, so your password is not the problem. Use the "
                    "browser sign-in instead: open the URL from GET /api/garmin/"
                    "signin-url, sign in, then post the ticket to /api/garmin/ticket.",
                ) from exc
            raise HTTPException(502, f"Garmin login failed: {exc}") from exc

    @app.get("/api/garmin/signin-url")
    def garmin_signin_url() -> dict[str, Any]:
        """The Garmin sign-in page to open in a real browser."""
        from ..ingest import connect as connect_mod

        return {"url": connect_mod.SIGNIN_URL}

    @app.post("/api/garmin/ticket")
    def garmin_ticket(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
        """Finish a browser sign-in: exchange its CAS ticket for the token cache."""
        try:
            return auth_mod.garmin_ticket(settings, str(payload.get("ticket") or ""))
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
        except Exception as exc:
            raise HTTPException(502, f"Ticket exchange failed: {exc}") from exc

    @app.post("/api/garmin/mfa")
    def garmin_mfa(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
        try:
            return auth_mod.garmin_mfa(
                settings,
                str(payload.get("challenge_id") or ""),
                str(payload.get("code") or ""),
            )
        except LookupError as exc:
            raise HTTPException(410, str(exc)) from exc
        except Exception as exc:
            raise HTTPException(502, f"MFA verification failed: {exc}") from exc

    @app.post("/api/garmin/disconnect")
    def garmin_disconnect() -> dict[str, Any]:
        return auth_mod.garmin_disconnect(settings)

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

    # -- aggregates ----------------------------------------------------------

    def _agg_filters(
        type: str | None, start: str | None, end: str | None, gear_id: int | None
    ) -> dict[str, Any]:
        return {
            "activity_type": type,
            "start": start,
            "end": end,
            "gear_id": gear_id,
        }

    @app.get("/api/aggregate")
    def api_aggregate(
        type: str | None = None,
        start: str | None = None,
        end: str | None = None,
        gear_id: int | None = None,
    ) -> dict[str, Any]:
        """Lifetime and per-period stats, distributions, patterns, streaks, records."""
        f = _agg_filters(type, start, end, gear_id)
        key = "aggregate:" + json.dumps(f, sort_keys=True, default=str)
        with store() as st:
            return cached(settings, key, lambda: agg_mod.compute_aggregate(st, **f))

    @app.get("/api/aggregate/filters")
    def api_aggregate_filters() -> dict[str, Any]:
        with store() as st:
            return agg_mod.available_filters(st)

    @app.get("/api/aggregate/periods")
    def api_aggregate_periods(
        period: str = Query("month", pattern="^(year|month|week)$"),
        type: str | None = None,
        start: str | None = None,
        end: str | None = None,
        gear_id: int | None = None,
    ) -> dict[str, Any]:
        f = _agg_filters(type, start, end, gear_id)
        with store() as st:
            return {"period": period, "rows": agg_mod.by_period(st, period, **f)}

    # -- activities ----------------------------------------------------------

    SORTABLE = {
        "day", "distance_m", "duration_s", "moving_time_s", "avg_hr", "max_hr",
        "avg_speed_mps", "elevation_gain_m", "calories", "trimp", "activity_type",
        "rpe",
    }

    @app.get("/api/activities")
    def api_activities(
        limit: int = Query(50, ge=1, le=1000),
        offset: int = Query(0, ge=0),
        type: str | None = None,
        start: str | None = None,
        end: str | None = None,
        q: str | None = None,
        gear_id: int | None = None,
        route_id: int | None = None,
        edited: bool | None = None,
        has_gps: bool | None = None,
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
        if gear_id:
            where.append(
                "EXISTS (SELECT 1 FROM activity_gear ag WHERE ag.activity_id = "
                "v_activities.activity_id AND ag.gear_id = ?)"
            )
            params.append(gear_id)
        if route_id:
            where.append("route_id = ?")
            params.append(route_id)
        if edited is not None:
            where.append("override_count > 0" if edited else "override_count = 0")
        if has_gps is not None:
            clause = "EXISTS (SELECT 1 FROM activity_samples s WHERE s.activity_id = " \
                     "v_activities.activity_id AND s.lat IS NOT NULL)"
            where.append(clause if has_gps else f"NOT {clause}")
        clause = (" WHERE " + " AND ".join(where)) if where else ""

        with store() as st:
            total = st.scalar(f"SELECT COUNT(*) FROM v_activities{clause}", params)
            rows = st.query(
                f"SELECT * FROM v_activities{clause} "
                f"ORDER BY {sort} {order.upper()}, activity_id DESC LIMIT ? OFFSET ?",
                [*params, limit, offset],
            )
            types = [
                r["activity_type"]
                for r in st.query(
                    "SELECT activity_type, COUNT(*) n FROM v_activities "
                    "GROUP BY activity_type ORDER BY n DESC"
                )
            ]
            return {"total": total, "limit": limit, "offset": offset, "types": types,
                    "rows": rows}

    @app.get("/api/activities/{activity_id}")
    def api_activity(activity_id: str, samples: bool = True) -> dict[str, Any]:
        with store() as st:
            act = ov_mod.effective(st, activity_id)
            if act is None:
                raise HTTPException(404, f"no activity {activity_id!r}")
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
                    "SELECT elapsed_s, distance_m, hr, speed_mps, cadence_spm, "
                    "altitude_m, lat, lon "
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
                "gear": gear_mod.for_activity(st, activity_id),
                "overrides": ov_mod.list_overrides(st, activity_id),
                "route": routes_mod.activity_track(st, activity_id)["route"],
                "has_gps": any(r.get("lat") is not None for r in sample_rows),
            }

    @app.get("/api/activities/{activity_id}/track")
    def api_activity_track(activity_id: str) -> dict[str, Any]:
        """The GPS stream for the map. `has_gps: false` for indoor activities."""
        with store() as st:
            if not ov_mod.activity_exists(st, activity_id):
                raise HTTPException(404, f"no activity {activity_id!r}")
            return routes_mod.activity_track(st, activity_id)

    # -- editing -------------------------------------------------------------

    @app.get("/api/fields")
    def api_fields() -> dict[str, Any]:
        """The editable-field registry. The UI builds its editors from this."""
        return {"fields": fields_mod.fields_json(),
                "activity_types": list(fields_mod.ACTIVITY_TYPES)}

    @app.patch("/api/activities/{activity_id}")
    def api_edit_activity(
        activity_id: str, payload: dict[str, Any] = Body(...)
    ) -> dict[str, Any]:
        """Apply user edits. Writes only to `overrides`; a sync can never undo them."""
        with store() as st:
            try:
                applied = ov_mod.set_many(st, activity_id, payload)
            except ov_mod.UnknownField as exc:
                raise HTTPException(400, str(exc)) from exc
            except ValueError as exc:
                raise HTTPException(400, str(exc)) from exc
            except LookupError as exc:
                raise HTTPException(404, str(exc)) from exc
            return {
                "activity": ov_mod.effective(st, activity_id),
                "applied": applied,
                "overrides": ov_mod.list_overrides(st, activity_id),
            }

    @app.delete("/api/activities/{activity_id}/overrides/{field}")
    def api_revert_field(activity_id: str, field: str) -> dict[str, Any]:
        """Reset one field to whatever Garmin says."""
        with store() as st:
            try:
                reverted = ov_mod.revert(st, activity_id, field)
            except ov_mod.UnknownField as exc:
                raise HTTPException(400, str(exc)) from exc
            return {
                "reverted": reverted,
                "activity": ov_mod.effective(st, activity_id),
                "overrides": ov_mod.list_overrides(st, activity_id),
            }

    @app.delete("/api/activities/{activity_id}/overrides")
    def api_revert_all(activity_id: str) -> dict[str, Any]:
        with store() as st:
            n = ov_mod.revert_all(st, activity_id)
            return {"reverted": n, "activity": ov_mod.effective(st, activity_id)}

    @app.post("/api/overrides/bulk")
    def api_bulk_override(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
        ids = payload.get("activity_ids") or []
        field = str(payload.get("field") or "")
        if not isinstance(ids, list):
            raise HTTPException(400, "activity_ids must be a list")
        if not ids:
            raise HTTPException(400, "activity_ids is required")
        with store() as st:
            try:
                return ov_mod.bulk_set(st, ids, field, payload.get("value"))
            except ov_mod.UnknownField as exc:
                raise HTTPException(400, str(exc)) from exc
            except ValueError as exc:
                raise HTTPException(400, str(exc)) from exc

    @app.get("/api/overrides")
    def api_overrides_summary() -> dict[str, Any]:
        with store() as st:
            return ov_mod.stats(st)

    # -- gear ----------------------------------------------------------------

    @app.get("/api/gear")
    def api_gear(include_retired: bool = True, kind: str | None = None) -> dict[str, Any]:
        with store() as st:
            return {
                "gear": gear_mod.list_gear(st, include_retired, kind),
                "defaults": gear_mod.list_defaults(st),
                "kinds": list(gear_mod.GEAR_KINDS),
            }

    @app.post("/api/gear")
    def api_gear_create(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
        with store() as st:
            try:
                attrs = gear_mod.clean_attrs(payload, gear_mod.CREATABLE)
                return gear_mod.create(st, **attrs)
            except gear_mod.GearError as exc:
                raise HTTPException(400, str(exc)) from exc
            except (TypeError, ValueError) as exc:
                raise HTTPException(400, f"bad gear payload: {exc}") from exc

    @app.get("/api/gear/{gear_id}")
    def api_gear_get(gear_id: int) -> dict[str, Any]:
        with store() as st:
            try:
                item = gear_mod.get(st, gear_id)
            except LookupError as exc:
                raise HTTPException(404, str(exc)) from exc
            activities = st.query(
                "SELECT v.activity_id, v.day, v.activity_name, v.activity_type, "
                "v.distance_m, v.moving_time_s FROM activity_gear ag "
                "JOIN v_activities v ON v.activity_id = ag.activity_id "
                "WHERE ag.gear_id = ? ORDER BY v.day DESC LIMIT 500",
                (gear_id,),
            )
            return {"gear": item, "activities": activities}

    @app.patch("/api/gear/{gear_id}")
    def api_gear_update(gear_id: int, payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
        with store() as st:
            try:
                attrs = gear_mod.clean_attrs(payload, gear_mod._EDITABLE)
                return gear_mod.update(st, gear_id, **attrs)
            except LookupError as exc:
                raise HTTPException(404, str(exc)) from exc
            except gear_mod.GearError as exc:
                raise HTTPException(400, str(exc)) from exc
            except (TypeError, ValueError) as exc:
                raise HTTPException(400, f"bad gear payload: {exc}") from exc

    @app.delete("/api/gear/{gear_id}")
    def api_gear_delete(gear_id: int) -> dict[str, Any]:
        with store() as st:
            return {"deleted": gear_mod.delete(st, gear_id)}

    @app.put("/api/activities/{activity_id}/gear")
    def api_set_activity_gear(
        activity_id: str, payload: dict[str, Any] = Body(...)
    ) -> dict[str, Any]:
        """Replace an activity's gear set — the drawer's dropdown, retroactively."""
        with store() as st:
            try:
                if "gear_ids" in payload:
                    return gear_mod.set_for_activity(
                        st, activity_id, [int(g) for g in payload["gear_ids"]]
                    )
                return gear_mod.assign(st, activity_id, int(payload["gear_id"]))
            except LookupError as exc:
                raise HTTPException(404, str(exc)) from exc
            except (KeyError, TypeError, ValueError) as exc:
                raise HTTPException(400, f"expected gear_id or gear_ids: {exc}") from exc

    @app.delete("/api/activities/{activity_id}/gear/{gear_id}")
    def api_unassign_gear(activity_id: str, gear_id: int) -> dict[str, Any]:
        with store() as st:
            return {"removed": gear_mod.unassign(st, activity_id, gear_id)}

    @app.post("/api/gear/{gear_id}/bulk-assign")
    def api_gear_bulk(gear_id: int, payload: dict[str, Any] = Body(default={})) -> dict[str, Any]:
        """Apply gear across a filtered date range — for importing gear-less history."""
        with store() as st:
            try:
                return gear_mod.bulk_assign(
                    st,
                    gear_id,
                    start=payload.get("start"),
                    end=payload.get("end"),
                    activity_type=payload.get("activity_type"),
                    only_unassigned=bool(payload.get("only_unassigned", False)),
                    dry_run=bool(payload.get("dry_run", False)),
                )
            except LookupError as exc:
                raise HTTPException(404, str(exc)) from exc

    @app.post("/api/gear/defaults")
    def api_gear_default(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
        with store() as st:
            try:
                return gear_mod.set_default(
                    st, str(payload["activity_type"]), int(payload["gear_id"])
                )
            except LookupError as exc:
                raise HTTPException(404, str(exc)) from exc
            except (KeyError, TypeError, ValueError) as exc:
                raise HTTPException(400, f"need activity_type and gear_id: {exc}") from exc

    @app.delete("/api/gear/defaults/{activity_type}/{gear_id}")
    def api_gear_default_clear(activity_type: str, gear_id: int) -> dict[str, Any]:
        with store() as st:
            return {"cleared": gear_mod.clear_default(st, activity_type, gear_id)}

    # -- routes & maps -------------------------------------------------------

    @app.get("/api/routes")
    def api_routes(type: str | None = None) -> dict[str, Any]:
        with store() as st:
            return {"routes": routes_mod.list_routes(st, type)}

    @app.get("/api/routes/{route_id}")
    def api_route(route_id: int) -> dict[str, Any]:
        with store() as st:
            try:
                return routes_mod.route_detail(st, route_id)
            except LookupError as exc:
                raise HTTPException(404, str(exc)) from exc

    @app.get("/api/routes/{route_id}/segments")
    def api_route_segments(route_id: int) -> dict[str, Any]:
        """Where you speed up and slow down, across every attempt at this route."""
        with store() as st:
            try:
                return routes_mod.segment_profile(st, route_id)
            except LookupError as exc:
                raise HTTPException(404, str(exc)) from exc

    @app.patch("/api/routes/{route_id}")
    def api_route_rename(route_id: int, payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
        with store() as st:
            try:
                return routes_mod.rename(st, route_id, str(payload.get("name") or ""))
            except LookupError as exc:
                raise HTTPException(404, str(exc)) from exc
            except ValueError as exc:
                raise HTTPException(400, str(exc)) from exc

    @app.post("/api/routes/{route_id}/merge")
    def api_route_merge(route_id: int, payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
        with store() as st:
            try:
                return routes_mod.merge(
                    st, route_id, [int(r) for r in payload.get("route_ids") or []]
                )
            except LookupError as exc:
                raise HTTPException(404, str(exc)) from exc

    @app.post("/api/routes/{route_id}/split")
    def api_route_split(route_id: int, payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
        with store() as st:
            try:
                return routes_mod.split(
                    st, route_id, payload.get("activity_ids") or [], payload.get("name")
                )
            except LookupError as exc:
                raise HTTPException(404, str(exc)) from exc
            except ValueError as exc:
                raise HTTPException(400, str(exc)) from exc

    @app.delete("/api/routes/{route_id}")
    def api_route_delete(route_id: int) -> dict[str, Any]:
        with store() as st:
            return {"deleted": routes_mod.delete_route(st, route_id)}

    @app.put("/api/activities/{activity_id}/route")
    def api_move_activity(
        activity_id: str, payload: dict[str, Any] = Body(...)
    ) -> dict[str, Any]:
        with store() as st:
            try:
                return routes_mod.move_activity(st, activity_id, int(payload["route_id"]))
            except LookupError as exc:
                raise HTTPException(404, str(exc)) from exc
            except (KeyError, TypeError, ValueError) as exc:
                raise HTTPException(400, f"need route_id: {exc}") from exc

    @app.get("/api/routes/compare/tracks")
    def api_route_compare(ids: str = Query(..., description="comma-separated activity ids")):
        """Two (or more) attempts overlaid, for the comparison view."""
        wanted = [i.strip() for i in ids.split(",") if i.strip()]
        if not 1 <= len(wanted) <= 5:
            raise HTTPException(400, "give between 1 and 5 activity ids")
        with store() as st:
            return routes_mod.compare(st, wanted)

    @app.get("/api/heatmap")
    def api_heatmap(
        type: str | None = None,
        start: str | None = None,
        end: str | None = None,
        precision: int = Query(routes_mod.HEATMAP_PRECISION, ge=2, le=6),
    ) -> dict[str, Any]:
        """Every GPS point ever recorded, snapped to a grid and counted."""
        key = f"heatmap:{type}:{start}:{end}:{precision}"
        with store() as st:
            return cached(
                settings,
                key,
                lambda: routes_mod.heatmap(st, type, start, end, precision),
            )

    @app.post("/api/routes/recluster")
    def api_recluster(payload: dict[str, Any] = Body(default={})) -> dict[str, Any]:
        """Re-run clustering. Routes the user has pinned are left alone."""
        with store() as st:
            return routes_mod.cluster_all(
                st, threshold=float(payload.get("threshold", routes_mod.MATCH_THRESHOLD))
            )

    # -- sync ----------------------------------------------------------------

    @app.get("/api/sync/status")
    def api_sync_status() -> dict[str, Any]:
        with store() as st:
            out = backfill_mod.status(st)
            out["thread_running"] = job.running
            out["last_error"] = job.last_error
            out["watermarks"] = st.watermarks()
            return out

    @app.get("/api/sync/estimate")
    def api_sync_estimate() -> dict[str, Any]:
        with store() as st:
            return backfill_mod.estimate(st)

    @app.post("/api/sync/start")
    def api_sync_start(payload: dict[str, Any] = Body(default={})) -> dict[str, Any]:
        """Kick off a full backfill in the background. Safe to call after a crash."""
        if not auth_mod.garmin_status(settings)["connected"]:
            raise HTTPException(
                409, "no Garmin account connected; sign in on the Settings tab first"
            )
        if job.running:
            raise HTTPException(409, "a sync is already running")

        phases = payload.get("phases") or list(backfill_mod.PHASES)
        limit = payload.get("detail_limit")

        def target(should_stop: Callable[[], bool]) -> None:
            with Store.open(settings) as st:
                backfill_mod.run(
                    st,
                    settings,
                    phases=phases,
                    detail_limit=int(limit) if limit else None,
                    echo=None,
                    should_stop=should_stop,
                )

        job.start(target)
        return {"status": "started", "phases": phases}

    @app.post("/api/sync/stop")
    def api_sync_stop() -> dict[str, Any]:
        return {"stopping": job.stop()}

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
            "athlete": {"hr_rest": settings.hr_rest, "hr_max": settings.hr_max,
                        "sex": settings.sex},
            "targets": {
                "peak_ctl": config.TARGET_PEAK_CTL,
                "peak_weekly_km": config.TARGET_PEAK_WEEKLY_KM,
            },
            "map": {"tile_url": settings.tile_url,
                    "attribution": settings.tile_attribution},
            "auth_required": app.state.auth_required,
            "version": __version__,
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

    # -- static dashboard ----------------------------------------------------

    web = settings.web_dir
    if web.is_dir():
        app.mount("/static", StaticFiles(directory=str(web)), name="static")

        @app.get("/login")
        def login_page() -> FileResponse:
            return FileResponse(str(web / "login.html"))

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
