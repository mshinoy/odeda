"""FastAPI app: JSON endpoints, the session gate, and the built React SPA.

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

import json
import statistics
import threading
import time
from collections.abc import Sequence
from datetime import date, datetime
from typing import Any, Callable

from fastapi import Body, FastAPI, HTTPException, Query, Request, Response
from fastapi.exception_handlers import http_exception_handler
from fastapi.responses import (
    FileResponse,
    JSONResponse,
    PlainTextResponse,
    RedirectResponse,
)
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

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
from ..edits import exercises as relabels_mod
from ..edits import gear as gear_mod
from ..edits import overrides as ov_mod
from ..ingest import backfill as backfill_mod
from ..seed import synthetic
from . import auth as auth_mod
from . import gym as gym_mod
from .schemas import (
    ActivityDetail,
    ActivityEditPayload,
    ActivityEditResult,
    ActivityExercises,
    ActivityGearRequest,
    ActivityGearResult,
    ActivityList,
    ActivityRouteRequest,
    ActivityRouteResult,
    ActivityStreams,
    CompareTracks,
    DailyList,
    ExerciseRelabelRequest,
    FieldsResponse,
    GarminStatus,
    GearList,
    Health,
    Heatmap,
    Performance,
    RacePanel,
    ReclusterRequest,
    ReclusterResult,
    Readiness,
    ReadinessHistory,
    RevertAllResult,
    RevertFieldResult,
    RouteDeleteResult,
    RouteDetail,
    RouteList,
    RouteMergeRequest,
    RouteMergeResult,
    RouteRenameRequest,
    RouteRenameResult,
    RouteSegments,
    RouteSplitRequest,
    RouteSplitResult,
    Summary,
    SyncStartRequest,
    SyncStarted,
    SyncStatus,
    SyncStopResult,
    TrainingLoad,
    Trends,
)

CACHE_TTL_S = 30.0
_cache: dict[str, tuple[float, float, Any]] = {}

#: Paths reachable without a session. Everything else is gated when a password is set.
#: `/login` is an SPA route: the fallback serves index.html and React draws the form.
PUBLIC_PREFIXES = ("/assets/", "/api/health", "/api/auth/", "/login", "/favicon")

UI_NOT_BUILT = (
    "UI not built. Run `npm run build` in frontend/ (or `npm run dev` for development).\n"
)


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
        # operationId = handler name (unique within create_app), so generated client
        # types read `api_activities` rather than `api_activities_api_activities_get`.
        generate_unique_id_function=lambda route: route.name,
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

    @app.get("/api/garmin/status", response_model=GarminStatus)
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
            # Tell the user which of the two failures this is: a credential Garmin
            # looked at and rejected, or an edge that never looked. Retyping a
            # password fixes only the first.
            if "401" in str(exc):
                raise HTTPException(
                    401,
                    "Garmin rejected that email and password. If they are right, check "
                    "for an unrecognised-device email from Garmin waiting for approval.",
                ) from exc
            if "429" in str(exc):
                # All five login strategies were rate-limited or bot-challenged. That
                # is an edge decision about this host, not about the credentials, and
                # it usually clears on its own within the hour.
                raise HTTPException(
                    503,
                    "Garmin refused the login without looking at the credentials — every "
                    "sign-in route it offers answered with a rate limit. That usually "
                    "clears within the hour; if it does not, the browser sign-in avoids "
                    "the blocked routes entirely: GET /api/garmin/signin-url, then POST "
                    "the ticket to /api/garmin/ticket.",
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

    @app.get("/api/health", response_model=Health)
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

    # exclude_unset: an empty database leaves `readiness.components` as `{}`; see
    # the note above the status models in schemas.py.
    @app.get("/api/summary", response_model=Summary, response_model_exclude_unset=True)
    def summary() -> dict[str, Any]:
        """Everything the Overview tab needs, in one round trip."""
        with store() as st:
            lo, hi = st.day_range()
            ld = cached(settings, "load", lambda: load_mod.compute_load(st))
            rd = ready_mod.compute_readiness(st)
            tr = cached(settings, "trends", lambda: trends_mod.compute_trends(st, days=180))
            rep = cached(settings, "reports", lambda: reports_mod.compute_reports(st))
            race = _race(st)
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
                    # The distance behind `projection.projected_seconds`, so a pace
                    # can be worked out without a second request.
                    "distance_m": race["race"]["distance_m"],
                    "days_to_go": race["days_to_go"],
                    "projection": race["projection"],
                },
                "recent_weeks": rep.get("weekly", [])[-8:],
                "gym": gym_mod.gym_this_week(st),
            }

    # -- analytics -----------------------------------------------------------

    # exclude_unset: with no activities, compute_load returns no warm-up keys and
    # no `ramp_flag`, and they stay absent rather than becoming nulls.
    @app.get("/api/load", response_model=TrainingLoad, response_model_exclude_unset=True)
    def api_load(
        start: str | None = Query(None, description="ISO date"),
        end: str | None = Query(None, description="ISO date"),
    ) -> dict[str, Any]:
        with store() as st:
            if start or end:
                return load_mod.compute_load(st, start, end)
            return cached(settings, "load", lambda: load_mod.compute_load(st))

    # exclude_unset: an empty database has no baseline to describe, so
    # `compute_trends` returns neither `baseline_days` nor `z_threshold`.
    @app.get("/api/trends", response_model=Trends, response_model_exclude_unset=True)
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

    @app.get("/api/readiness", response_model=Readiness, response_model_exclude_unset=True)
    def api_readiness(day: str | None = None) -> dict[str, Any]:
        with store() as st:
            return ready_mod.compute_readiness(st, day)

    @app.get("/api/readiness/history", response_model=ReadinessHistory)
    def api_readiness_history(days: int = Query(90, ge=7, le=800)) -> dict[str, Any]:
        with store() as st:
            return {"days": days, "series": ready_mod.readiness_history(st, days)}

    @app.get("/api/performance", response_model=Performance)
    def api_performance() -> dict[str, Any]:
        with store() as st:
            return cached(settings, "performance", lambda: perf.compute_performance(st))

    @app.get("/api/race", response_model=RacePanel)
    def api_race() -> dict[str, Any]:
        with store() as st:
            return _race(st)

    @app.get("/api/reports")
    def api_reports() -> dict[str, Any]:
        with store() as st:
            return cached(settings, "reports", lambda: reports_mod.compute_reports(st))

    @app.get("/api/daily", response_model=DailyList)
    def api_daily(days: int = Query(400, ge=1, le=3000)) -> dict[str, Any]:
        with store() as st:
            # `light_s` is joined on here rather than added to `v_daily`: the view feeds
            # the trend engine, and a sleep-stage chart is the only thing that needs it.
            rows = st.query(
                "SELECT v.*, s.light_s AS light_s"
                " FROM v_daily v LEFT JOIN sleep s ON s.day = v.day"
                " ORDER BY v.day"
            )
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

    @app.get("/api/activities", response_model=ActivityList)
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
        race: bool | None = None,
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
        if race is not None:
            where.append(f"{gym_mod.RACE_SQL} = {1 if race else 0}")
        clause = (" WHERE " + " AND ".join(where)) if where else ""

        with store() as st:
            total = st.scalar(f"{gym_mod.COUNT_SQL}{clause}", params)
            rows = gym_mod.activity_rows(
                st,
                f"{clause} ORDER BY {sort} {order.upper()}, activity_id DESC "
                "LIMIT ? OFFSET ?",
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

    @app.get("/api/activities/{activity_id}", response_model=ActivityDetail)
    def api_activity(activity_id: str) -> dict[str, Any]:
        """One activity with everything derived from it. The stream is `/streams`."""
        with store() as st:
            act = gym_mod.activity_row(st, activity_id)
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
            # Only what the derived numbers below need; the stream itself is /streams.
            sample_rows = st.query(
                "SELECT elapsed_s, distance_m, hr, lat "
                "FROM activity_samples WHERE activity_id = ? ORDER BY elapsed_s",
                (activity_id,),
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
            route = st.query(
                "SELECT m.route_id, m.match_score, m.assigned, r.name FROM route_members m "
                "JOIN routes r ON r.route_id = m.route_id WHERE m.activity_id = ?",
                (activity_id,),
            )
            return {
                "activity": act,
                "hr_zones": zones,
                "best_efforts": [
                    {**b, "label": perf.DISTANCE_LABELS.get(b["distance_m"])}
                    for b in bests
                ],
                "decoupling_pct": None if dec is None else round(dec, 2),
                "efficiency_factor": None if ef is None else round(ef, 3),
                "km_splits": _splits(sample_rows),
                "gear": gear_mod.for_activity(st, activity_id),
                "overrides": ov_mod.list_overrides(st, activity_id),
                "route": route[0] if route else None,
                "has_gps": any(r.get("lat") is not None for r in sample_rows),
            }

    @app.get("/api/activities/{activity_id}/streams", response_model=ActivityStreams)
    def api_activity_streams(activity_id: str) -> dict[str, Any]:
        """Every sample of the activity, columnar, ordered by elapsed time.

        Indoor activities are included; their `lat`/`lon` are all null.
        """
        cols = ("elapsed_s", "distance_m", "hr", "speed_mps", "cadence_spm",
                "altitude_m", "lat", "lon")
        with store() as st:
            if not ov_mod.activity_exists(st, activity_id):
                raise HTTPException(404, f"no activity {activity_id!r}")
            rows = st.conn.execute(
                f"SELECT {', '.join(cols)} FROM activity_samples "
                "WHERE activity_id = ? ORDER BY elapsed_s",
                (activity_id,),
            ).fetchall()
        out: dict[str, Any] = {"activity_id": activity_id, "sample_count": len(rows)}
        for i, col in enumerate(cols):
            out[col] = [r[i] for r in rows]
        return out

    @app.get("/api/activities/{activity_id}/exercises", response_model=ActivityExercises)
    def api_activity_exercises(activity_id: str) -> dict[str, Any]:
        """The exercises Garmin summarised for a gym session, from the raw payload.

        Empty (null totals, no exercises) for an activity without exercise data.
        """
        with store() as st:
            body = gym_mod.activity_exercises(st, activity_id)
        if body is None:
            raise HTTPException(404, f"no activity {activity_id!r}")
        return body

    @app.put(
        "/api/activities/{activity_id}/exercises/{index}", response_model=ActivityExercises
    )
    def api_relabel_exercise(
        activity_id: str, index: int, payload: ExerciseRelabelRequest = Body(...)
    ) -> dict[str, Any]:
        """Say what an exercise really was, when Garmin guessed wrong or not at all.

        Stored in `overrides` under `exercise:<index>`, so a re-sync cannot undo it.
        """
        with store() as st:
            entry = _exercise_entry(st, activity_id, index)
            try:
                label = relabels_mod.clean_label(payload.category, payload.sub_category)
            except relabels_mod.BadRelabel as exc:
                raise HTTPException(400, str(exc)) from exc
            relabels_mod.set_relabel(
                st,
                activity_id,
                index,
                label,
                relabels_mod.format_label(entry["garmin_category"], entry["garmin_sub_category"]),
            )
            body = gym_mod.activity_exercises(st, activity_id)
            assert body is not None  # the activity existed a moment ago
            return body

    @app.delete(
        "/api/activities/{activity_id}/exercises/{index}", response_model=ActivityExercises
    )
    def api_revert_exercise(activity_id: str, index: int) -> dict[str, Any]:
        """Drop a relabel, so Garmin's own guess shows through again."""
        with store() as st:
            _exercise_entry(st, activity_id, index)
            relabels_mod.clear_relabel(st, activity_id, index)
            body = gym_mod.activity_exercises(st, activity_id)
            assert body is not None
            return body

    def _exercise_entry(st: Any, activity_id: str, index: int) -> dict[str, Any]:
        """The exercise at `index`, or a 404 naming which half is missing."""
        body = gym_mod.activity_exercises(st, activity_id)
        if body is None:
            raise HTTPException(404, f"no activity {activity_id!r}")
        for entry in body["exercises"]:
            if entry["index"] == index:
                return entry
        raise HTTPException(404, f"activity {activity_id!r} has no exercise {index}")

    # `GET /api/activities/{id}/track` was dropped in T05a: `/streams` carries the same
    # samples columnar, the route assignment is on the activity detail, and the map
    # computes its own bounds. `routes.activity_track` stays; the comparison view uses it.

    # -- editing -------------------------------------------------------------

    @app.get("/api/fields", response_model=FieldsResponse)
    def api_fields() -> dict[str, Any]:
        """The editable-field registry. The UI builds its editors from this."""
        return {"fields": fields_mod.fields_json(),
                "activity_types": list(fields_mod.ACTIVITY_TYPES)}

    @app.patch("/api/activities/{activity_id}", response_model=ActivityEditResult)
    def api_edit_activity(
        activity_id: str, payload: ActivityEditPayload = Body(...)
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
                "activity": gym_mod.activity_row(st, activity_id),
                "applied": applied,
                "overrides": ov_mod.list_overrides(st, activity_id),
            }

    @app.delete(
        "/api/activities/{activity_id}/overrides/{field}", response_model=RevertFieldResult
    )
    def api_revert_field(activity_id: str, field: str) -> dict[str, Any]:
        """Reset one field to whatever Garmin says."""
        with store() as st:
            try:
                reverted = ov_mod.revert(st, activity_id, field)
            except ov_mod.UnknownField as exc:
                raise HTTPException(400, str(exc)) from exc
            return {
                "reverted": reverted,
                "activity": gym_mod.activity_row(st, activity_id),
                "overrides": ov_mod.list_overrides(st, activity_id),
            }

    @app.delete("/api/activities/{activity_id}/overrides", response_model=RevertAllResult)
    def api_revert_all(activity_id: str) -> dict[str, Any]:
        """Reset every edited field on the activity to whatever Garmin says."""
        with store() as st:
            n = ov_mod.revert_all(st, activity_id)
            return {"reverted": n, "activity": gym_mod.activity_row(st, activity_id)}

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

    @app.get("/api/gear", response_model=GearList)
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

    @app.put("/api/activities/{activity_id}/gear", response_model=ActivityGearResult)
    def api_set_activity_gear(
        activity_id: str, payload: ActivityGearRequest = Body(...)
    ) -> dict[str, Any]:
        """Replace an activity's gear set — the dialog's dropdown, retroactively."""
        with store() as st:
            try:
                if payload.gear_ids is not None:
                    return gear_mod.set_for_activity(st, activity_id, payload.gear_ids)
                if payload.gear_id is None:
                    raise HTTPException(400, "expected gear_id or gear_ids")
                return gear_mod.assign(st, activity_id, payload.gear_id)
            except LookupError as exc:
                raise HTTPException(404, str(exc)) from exc

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

    @app.get("/api/routes", response_model=RouteList)
    def api_routes(type: str | None = None) -> dict[str, Any]:
        with store() as st:
            rows = routes_mod.list_routes(st, type)
            medians = _route_median_times(st)
            for row in rows:
                row["median_moving_time_s"] = medians.get(int(row["route_id"]))
            return {"routes": rows}

    @app.get("/api/routes/{route_id}", response_model=RouteDetail)
    def api_route(route_id: int) -> dict[str, Any]:
        with store() as st:
            try:
                return _columnar_route_detail(routes_mod.route_detail(st, route_id))
            except LookupError as exc:
                raise HTTPException(404, str(exc)) from exc

    @app.get("/api/routes/{route_id}/segments", response_model=RouteSegments)
    def api_route_segments(route_id: int) -> dict[str, Any]:
        """Where you speed up and slow down, across every attempt at this route."""
        with store() as st:
            try:
                return _columnar_segments(routes_mod.segment_profile(st, route_id))
            except LookupError as exc:
                raise HTTPException(404, str(exc)) from exc

    @app.patch("/api/routes/{route_id}", response_model=RouteRenameResult)
    def api_route_rename(
        route_id: int, payload: RouteRenameRequest = Body(...)
    ) -> dict[str, Any]:
        with store() as st:
            try:
                return routes_mod.rename(st, route_id, payload.name)
            except LookupError as exc:
                raise HTTPException(404, str(exc)) from exc
            except ValueError as exc:
                raise HTTPException(400, str(exc)) from exc

    @app.post("/api/routes/{route_id}/merge", response_model=RouteMergeResult)
    def api_route_merge(route_id: int, payload: RouteMergeRequest = Body(...)) -> dict[str, Any]:
        with store() as st:
            try:
                return routes_mod.merge(st, route_id, payload.route_ids)
            except LookupError as exc:
                raise HTTPException(404, str(exc)) from exc

    @app.post("/api/routes/{route_id}/split", response_model=RouteSplitResult)
    def api_route_split(route_id: int, payload: RouteSplitRequest = Body(...)) -> dict[str, Any]:
        with store() as st:
            try:
                return routes_mod.split(st, route_id, payload.activity_ids, payload.name)
            except LookupError as exc:
                raise HTTPException(404, str(exc)) from exc
            except ValueError as exc:
                raise HTTPException(400, str(exc)) from exc

    @app.delete("/api/routes/{route_id}", response_model=RouteDeleteResult)
    def api_route_delete(route_id: int) -> dict[str, Any]:
        with store() as st:
            return {"deleted": routes_mod.delete_route(st, route_id)}

    @app.put("/api/activities/{activity_id}/route", response_model=ActivityRouteResult)
    def api_move_activity(
        activity_id: str, payload: ActivityRouteRequest = Body(...)
    ) -> dict[str, Any]:
        with store() as st:
            try:
                return routes_mod.move_activity(st, activity_id, payload.route_id)
            except LookupError as exc:
                raise HTTPException(404, str(exc)) from exc

    @app.get("/api/routes/compare/tracks", response_model=CompareTracks)
    def api_route_compare(
        ids: str = Query(..., description="comma-separated activity ids"),
    ) -> dict[str, Any]:
        """Two (or more) attempts overlaid, for the comparison view."""
        wanted = [i.strip() for i in ids.split(",") if i.strip()]
        if not 1 <= len(wanted) <= 5:
            raise HTTPException(400, "give between 1 and 5 activity ids")
        with store() as st:
            return _columnar_compare(st, routes_mod.compare(st, wanted))

    @app.get("/api/heatmap", response_model=Heatmap)
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
                lambda: _columnar_heatmap(routes_mod.heatmap(st, type, start, end, precision)),
            )

    @app.post("/api/routes/recluster", response_model=ReclusterResult)
    def api_recluster(
        payload: ReclusterRequest = Body(default_factory=ReclusterRequest),
    ) -> dict[str, Any]:
        """Re-run clustering. Routes the user has pinned are left alone."""
        threshold = routes_mod.MATCH_THRESHOLD if payload.threshold is None else payload.threshold
        with store() as st:
            return routes_mod.cluster_all(st, threshold=threshold)

    # -- sync ----------------------------------------------------------------

    # exclude_unset: the resume cursor only ever holds the keys its phase wrote.
    @app.get("/api/sync/status", response_model=SyncStatus,
             response_model_exclude_unset=True)
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

    @app.post("/api/sync/start", response_model=SyncStarted)
    def api_sync_start(
        payload: SyncStartRequest = Body(default_factory=SyncStartRequest),
    ) -> dict[str, Any]:
        """Kick off a full backfill in the background. Safe to call after a crash."""
        if not auth_mod.garmin_status(settings)["connected"]:
            raise HTTPException(
                409, "no Garmin account connected; run `garmin-analytics login` first"
            )
        if job.running:
            raise HTTPException(409, "a sync is already running")

        phases = payload.phases or list(backfill_mod.PHASES)
        limit = payload.detail_limit

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

    @app.post("/api/sync/stop", response_model=SyncStopResult)
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

    # -- the SPA -------------------------------------------------------------
    # Last, and only for what no route matched: /api, /openapi.json and /docs win.
    _mount_ui(app, settings)

    return app


def _mount_ui(app: FastAPI, settings: Settings) -> None:
    """Serve the React build: hashed bundles under /assets, index.html for the rest.

    Client-side routing means `/activities/123` is a page the server has never heard
    of, so a GET that matched no route, is not under /api/ or /assets/, and is not a
    real top-level file of the build gets index.html and the router takes it from
    there. It is a 404 handler rather than a catch-all route on purpose: a route
    would match every path, turning a POST to a mistyped endpoint into a 405 and a
    GET on a POST-only endpoint into a 404. As a handler, the API's own status codes
    are untouched, and a mistyped `/api/...` stays a JSON 404 rather than a 200 of
    HTML. A missing `/assets/...` chunk stays a 404 too, not HTML under a .js name.
    """
    ui = settings.ui_dir.resolve()
    index = ui / "index.html"
    built = index.is_file()
    if built and (ui / "assets").is_dir():
        app.mount("/assets", StaticFiles(directory=str(ui / "assets")), name="assets")

    @app.exception_handler(StarletteHTTPException)
    async def spa_fallback(request: Request, exc: StarletteHTTPException) -> Response:
        path = request.url.path
        if (
            exc.status_code != 404
            or request.method not in ("GET", "HEAD")
            or path == "/api"
            or path.startswith(("/api/", "/assets/"))
        ):
            return await http_exception_handler(request, exc)
        if not built:
            return PlainTextResponse(UI_NOT_BUILT, status_code=503)
        name = path.lstrip("/")
        if name and "/" not in name:
            candidate = (ui / name).resolve()
            # resolve() folds away any `..` or symlink; the parent check is what
            # actually keeps a crafted path inside the build directory.
            if candidate.parent == ui and candidate.is_file():
                return FileResponse(str(candidate))
        # index.html names the hashed bundles, so it must be revalidated after a
        # rebuild; the bundles themselves are immutable by name.
        return FileResponse(str(index), headers={"Cache-Control": "no-cache"})


def _race(st: Store) -> dict[str, Any]:
    """`compute_race`, plus `projection.from_seconds`: the time of the best effort the
    projection starts from, which the analytics only return as a string.

    The source is found the way `compute_race` found it: among the recent bests, or
    all-time bests when there are no recent ones, the entry at `from_distance_m`
    (there is one best per standard distance).
    """
    race = ready_mod.compute_race(st)
    proj = race["projection"]
    if proj is not None:
        bests = race["recent_bests"] or perf.personal_bests(st)
        source = next(b for b in bests if b["distance_m"] == proj["from_distance_m"])
        race["projection"] = {**proj, "from_seconds": source["seconds"]}
    return race


def _columnar_compare(store: Store, result: dict[str, Any]) -> dict[str, Any]:
    """Compare tracks reshaped into `/streams`' columns, with each activity's type.

    A compared activity then arrives in the browser in exactly the shape one on its
    own page does, so the same adapter derives its smoothed pace and its GeoJSON line.
    The type is not in `routes.compare`'s own select and the view needs it to know
    whether a pace reads in /km or km/h, so it is looked up here.
    """
    ids = [a["activity"]["activity_id"] for a in result["attempts"]]
    types = _activity_types(store, ids)
    return {
        "count": result["count"],
        "attempts": [
            {
                "activity": {
                    **attempt["activity"],
                    "activity_type": types.get(attempt["activity"]["activity_id"], "other"),
                },
                "streams": _track_streams(attempt["track"]),
            }
            for attempt in result["attempts"]
        ],
    }


def _activity_types(store: Store, ids: Sequence[str]) -> dict[str, str]:
    if not ids:
        return {}
    placeholders = ",".join("?" for _ in ids)
    rows = store.query(
        f"SELECT activity_id, activity_type FROM v_activities "
        f"WHERE activity_id IN ({placeholders})",
        list(ids),
    )
    return {r["activity_id"]: r["activity_type"] for r in rows}


def _track_streams(track: dict[str, Any]) -> dict[str, Any]:
    """One `activity_track` turned columnar. `fields` names the tuple's positions."""
    points: list[Sequence[Any]] = track["points"]
    columns = {name: [p[i] for p in points] for i, name in enumerate(track["fields"])}
    return {"activity_id": track["activity_id"], "sample_count": len(points), **columns}


def _polyline(points: Sequence[Sequence[Any]]) -> dict[str, list[Any]]:
    """`[lat, lon, ...]` points become columns, for the reason `_columnar_heatmap` does."""
    return {"lat": [p[0] for p in points], "lon": [p[1] for p in points]}


def _columnar_route_detail(detail: dict[str, Any]) -> dict[str, Any]:
    """A route's `[lat, lon, altitude_m, cumulative_m]` polyline, columnar."""
    route = detail["route"]
    points = route["points"]
    return {
        **detail,
        "route": {
            **route,
            "points": {
                **_polyline(points),
                "altitude_m": [p[2] for p in points],
                "distance_m": [p[3] for p in points],
            },
        },
    }


def _columnar_segments(profile: dict[str, Any]) -> dict[str, Any]:
    """Each segment's slice of the polyline, columnar.

    `fastest_segments` and `slowest_segments` hold the same dicts as `segments`, so
    each list is rebuilt rather than edited: converting twice would be a bug.
    """
    def columnar(segment: dict[str, Any]) -> dict[str, Any]:
        return {**segment, "path": _polyline(segment["path"])}

    return {
        **profile,
        "segments": [columnar(s) for s in profile["segments"]],
        "fastest_segments": [columnar(s) for s in profile.get("fastest_segments", [])],
        "slowest_segments": [columnar(s) for s in profile.get("slowest_segments", [])],
    }


def _route_median_times(store: Store) -> dict[int, float]:
    """Each route's median moving time, over the attempts that count.

    SQLite has no median aggregate, so the times come back in one grouped read and
    the median is taken here. Same source as `list_routes`' best and average, so the
    three numbers in a row always describe the same set of attempts.
    """
    times: dict[int, list[float]] = {}
    for row in store.query(
        "SELECT m.route_id, v.moving_time_s FROM route_members m "
        "JOIN v_activities_included v ON v.activity_id = m.activity_id "
        "WHERE v.moving_time_s IS NOT NULL AND v.moving_time_s > 0"
    ):
        times.setdefault(int(row["route_id"]), []).append(float(row["moving_time_s"]))
    return {rid: round(statistics.median(values), 1) for rid, values in times.items()}


def _columnar_heatmap(grid: dict[str, Any]) -> dict[str, Any]:
    """`[lat, lon, n]` triples become three equal-length columns, as `/streams` does.

    Tens of thousands of two-element arrays cost far more JSON than three arrays of
    numbers, and the browser reads a column straight into a typed loop.
    """
    lat, lon, count = zip(*grid["points"]) if grid["points"] else ((), (), ())
    return {
        "precision": grid["precision"],
        "cells": grid["cells"],
        "max_count": grid["max_count"],
        "lat": list(lat),
        "lon": list(lon),
        "count": list(count),
    }


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
