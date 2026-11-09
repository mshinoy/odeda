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
import urllib.parse
from collections.abc import Sequence
from contextlib import asynccontextmanager
from datetime import date, datetime
from typing import Any, Callable, Literal

from fastapi import Body, FastAPI, HTTPException, Query, Request, Response
from fastapi.exception_handlers import http_exception_handler
from fastapi.responses import (
    FileResponse,
    HTMLResponse,
    JSONResponse,
    PlainTextResponse,
    RedirectResponse,
)
from fastapi.staticfiles import StaticFiles
from starlette.middleware.gzip import GZipMiddleware
from starlette.exceptions import HTTPException as StarletteHTTPException

from .. import __version__, config
from ..analytics import aggregate as agg_mod
from ..analytics import body as body_mod
from ..analytics import forecast as forecast_mod
from ..analytics import gaps as gaps_mod
from ..analytics import load as load_mod
from ..analytics import pacing as pacing_mod
from ..analytics import performance as perf
from ..analytics import plan as plan_mod
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
from ..ingest import auto_sync as auto_mod
from ..ingest import plan_ics as plan_ics_mod
from ..ingest import backfill as backfill_mod
from ..seed import synthetic
from . import auth as auth_mod
from . import gym as gym_mod
from .cache import CacheWarmer, cached
from . import preview as preview_mod
from .schemas import (
    ActivityDetail,
    Aggregate,
    AggregateFilters,
    AggregatePeriods,
    ActivityEditPayload,
    ActivityEditResult,
    ActivityExercises,
    ActivityGaps,
    ActivityGearRequest,
    ActivityGearResult,
    ActivityList,
    ActivityPreviews,
    ActivityRouteRequest,
    ActivityRouteResult,
    ActivityStreams,
    BodyComposition,
    FitbitAuthorizeUrl,
    FitbitConnectRequest,
    FitbitConnected,
    FitbitDisconnected,
    FitbitImportRequest,
    FitbitImportResult,
    FitbitStatus,
    FitbitSyncResult,
    CompareTracks,
    DailyList,
    ExerciseRelabelRequest,
    FieldsResponse,
    ActivityGearRemoved,
    AppConfig,
    GarminConnected,
    GarminDisconnected,
    GarminLoginRequest,
    GarminLoginResult,
    GarminMfaRequest,
    GarminSigninUrl,
    GarminStatus,
    GarminTicketRequest,
    GearItem,
    GearList,
    Health,
    Heatmap,
    Performance,
    Plan,
    PlanLinkRequest,
    PlanLinkResult,
    PlanSessionList,
    PlanSourceRequest,
    PlanStartRequest,
    PlanSyncResult,
    PlanWeekDetail,
    RaceForecast,
    RacePacing,
    RacePanel,
    ReclusterRequest,
    Reports,
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
    RouteSimilarList,
    RouteSplitRequest,
    RouteSplitResult,
    Summary,
    GearBulkAssignRequest,
    GearBulkAssignResult,
    GearCreateRequest,
    GearDefaultCleared,
    GearDefaultRequest,
    GearDefaultsResult,
    GearDeleted,
    GearDetail,
    GearWriteRequest,
    OverridesSummary,
    SyncEstimate,
    SyncStartRequest,
    SyncStarted,
    SyncStatus,
    SyncStopResult,
    AutoSyncStatus,
    TrainingLoad,
    Trends,
)

#: Paths reachable without a session. Everything else is gated when a password is set.
#: `/login` is an SPA route: the fallback serves index.html and React draws the form.
PUBLIC_PREFIXES = ("/assets/", "/api/health", "/api/auth/", "/login", "/favicon")

UI_NOT_BUILT = (
    "UI not built. Run `npm run build` in frontend/ (or `npm run dev` for development).\n"
)


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


def _fitbit_page(message: str) -> str:
    """The one HTML page this API serves that is not the SPA.

    Fitbit's redirect lands a *browser* here, not the app, so it has to render on its
    own. Deliberately one sentence with no styling and no link back: it is a dead end
    the user closes, and anything more would be a second UI to keep in step with the
    real one. The message is escaped because `error` comes from a query string.
    """
    from html import escape

    return (
        "<!doctype html><html><head><meta charset='utf-8'><title>Fitbit</title></head>"
        f"<body><p>{escape(message)}</p></body></html>"
    )


def heatmap_cached(
    settings: Settings,
    activity_type: str | None = None,
    start: str | None = None,
    end: str | None = None,
    precision: int = routes_mod.HEATMAP_PRECISION,
) -> dict[str, Any]:
    """`/api/heatmap`'s body, from the cache when the data has not changed since."""
    key = f"heatmap:{activity_type}:{start}:{end}:{precision}"

    def compute() -> dict[str, Any]:
        with Store.open(settings) as st:
            grid = routes_mod.heatmap(st, activity_type, start, end, precision)
        return _columnar_heatmap(grid)

    return cached(settings, key, compute)


def warm_caches(settings: Settings) -> None:
    """What the cache warmer computes ahead of the first ask: the Map page opens on
    the unfiltered heatmap, which is the slowest thing any page waits for (~1 s)."""
    heatmap_cached(settings)


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or load_settings()
    settings.ensure_dirs()

    job = BackgroundJob()
    # Waits for a manual backfill rather than running alongside it; the manual routes
    # below return 409 while this runs, for the same reason.
    auto = auto_mod.AutoSync(settings, settings.auto_sync_hours, is_busy=lambda: job.running)
    warmer = CacheWarmer(
        settings,
        warm=lambda: warm_caches(settings),
        is_busy=lambda: job.running or auto.running,
    )

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        auto.start()
        if settings.cache_warm:
            warmer.start()
        try:
            yield
        finally:
            warmer.stop()
            auto.stop()

    app = FastAPI(
        title="Garmin Analytics",
        version=__version__,
        description="Self-hosted analytics over your own Garmin Connect history.",
        # operationId = handler name (unique within create_app), so generated client
        # types read `api_activities` rather than `api_activities_api_activities_get`.
        generate_unique_id_function=lambda route: route.name,
        lifespan=lifespan,
    )
    # StaticFiles does not compress, so without this the browser is sent the whole
    # 1.2 MB of JavaScript however politely it asked for gzip. The SPA's first load
    # is about 1.4 MB uncompressed and about 0.45 MB with this on. The minimum keeps
    # it off the small JSON replies, where the CPU costs more than the bytes save.
    app.add_middleware(GZipMiddleware, minimum_size=1024)

    app.state.job = job
    app.state.auto_sync = auto

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

    @app.post("/api/garmin/login", response_model=GarminLoginResult)
    def garmin_login(payload: GarminLoginRequest = Body(...)) -> dict[str, Any]:
        """Exchange Garmin credentials for a token cache. Credentials are not stored."""
        try:
            return auth_mod.garmin_login(
                settings, payload.email.strip(), payload.password
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

    @app.get("/api/garmin/signin-url", response_model=GarminSigninUrl)
    def garmin_signin_url() -> dict[str, Any]:
        """The Garmin sign-in page to open in a real browser."""
        from ..ingest import connect as connect_mod

        return {"url": connect_mod.SIGNIN_URL}

    @app.post("/api/garmin/ticket", response_model=GarminConnected)
    def garmin_ticket(payload: GarminTicketRequest = Body(...)) -> dict[str, Any]:
        """Finish a browser sign-in: exchange its CAS ticket for the token cache."""
        try:
            return auth_mod.garmin_ticket(settings, payload.ticket)
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
        except Exception as exc:
            raise HTTPException(502, f"Ticket exchange failed: {exc}") from exc

    @app.post("/api/garmin/mfa", response_model=GarminConnected)
    def garmin_mfa(payload: GarminMfaRequest = Body(...)) -> dict[str, Any]:
        try:
            return auth_mod.garmin_mfa(settings, payload.challenge_id, payload.code)
        except LookupError as exc:
            raise HTTPException(410, str(exc)) from exc
        except Exception as exc:
            raise HTTPException(502, f"MFA verification failed: {exc}") from exc

    @app.post("/api/garmin/disconnect", response_model=GarminDisconnected)
    def garmin_disconnect() -> dict[str, Any]:
        return auth_mod.garmin_disconnect(settings)

    # -- Fitbit connection (the scale) ---------------------------------------
    #
    # Google Health is the second data source and the only one that knows what the
    # owner weighs. See HANDOVER-FITBIT.md for what is proven and what is not.

    @app.get("/api/fitbit/status", response_model=FitbitStatus)
    def fitbit_status() -> dict[str, Any]:
        return auth_mod.fitbit_status(settings)

    @app.get("/api/fitbit/authorize-url", response_model=FitbitAuthorizeUrl)
    def fitbit_authorize_url() -> dict[str, Any]:
        """The consent URL to open. The PKCE verifier behind it never leaves the server."""
        from ..ingest import fitbit as fitbit_mod

        try:
            return auth_mod.fitbit_authorize_url(settings)
        except fitbit_mod.NotConnected as exc:
            # No client id and secret yet. That is a setup step, not a failure.
            raise HTTPException(409, str(exc)) from exc

    @app.post("/api/fitbit/connect", response_model=FitbitConnected)
    def fitbit_connect(payload: FitbitConnectRequest = Body(...)) -> dict[str, Any]:
        """Finish the flow from the address bar the browser landed on."""
        from ..ingest import fitbit as fitbit_mod

        try:
            return auth_mod.fitbit_connect(settings, payload.redirect)
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
        except LookupError as exc:
            raise HTTPException(410, str(exc)) from exc
        except fitbit_mod.MissingConsent as exc:
            # The sign-in worked; the permission did not. 403 rather than 400 because
            # nothing about the request was malformed.
            raise HTTPException(403, str(exc)) from exc
        except fitbit_mod.ProfileNotReady as exc:
            # 412 straight through: the tokens are saved and good, the account just has
            # no Google Health profile yet. The message names the app to open.
            raise HTTPException(412, str(exc)) from exc
        except fitbit_mod.NeedsReauthorization as exc:
            raise HTTPException(400, str(exc)) from exc
        except fitbit_mod.FitbitError as exc:
            raise HTTPException(502, str(exc)) from exc

    @app.get("/api/fitbit/callback", response_class=HTMLResponse)
    def fitbit_callback(code: str = "", state: str = "", error: str = "") -> HTMLResponse:
        """Where Fitbit sends the browser back to.

        This exists so the common case is one click: the redirect lands here, the
        exchange happens, and the user is told to go back to Settings. It is not the
        only way in — `POST /api/fitbit/connect` takes a pasted URL — because this
        route only works if the registered redirect actually points at this app, and
        whether it does is a setting on the Google Cloud OAuth client that nothing
        here controls.
        """
        from ..ingest import fitbit as fitbit_mod

        if error:
            return HTMLResponse(_fitbit_page(f"Google returned “{error}”."), status_code=400)
        # Re-encode rather than interpolate: FastAPI hands these over already decoded,
        # and a Google code contains a `/` that has to survive the round trip.
        query = urllib.parse.urlencode({"code": code, "state": state})
        try:
            auth_mod.fitbit_connect(settings, f"?{query}")
        except fitbit_mod.ProfileNotReady as exc:
            # The tokens are saved; only the Google Health profile is missing. A 400
            # here would read as "the sign-in failed", which is the wrong instruction.
            return HTMLResponse(_fitbit_page(str(exc)), status_code=412)
        except (ValueError, LookupError, fitbit_mod.FitbitError) as exc:
            return HTMLResponse(_fitbit_page(str(exc)), status_code=400)
        return HTMLResponse(
            _fitbit_page("Google Health connected. You can close this tab.")
        )

    @app.post("/api/fitbit/disconnect", response_model=FitbitDisconnected)
    def fitbit_disconnect() -> dict[str, Any]:
        return auth_mod.fitbit_disconnect(settings)

    @app.post("/api/fitbit/sync", response_model=FitbitSyncResult)
    def fitbit_sync_now(since: str | None = None) -> dict[str, Any]:
        """Pull weigh-ins. Synchronous, and that is a considered choice.

        A full history is two cursor-paged fetches against a 300-request-a-minute
        budget, so the whole job is seconds — short enough to answer in a request, and
        not worth the machinery of a background job with its own status row. If the
        budget does run out it returns `rate_limited` with its place kept, and running
        it again resumes.
        """
        from ..ingest import fitbit as fitbit_mod
        from ..ingest import fitbit_sync as fitbit_sync_mod

        if auto.running:
            raise HTTPException(409, "an automatic sync is running")
        try:
            client = fitbit_mod.FitbitClient.resume(settings.token_dir)
            start = date.fromisoformat(since) if since else None
            with store() as st:
                return fitbit_sync_mod.sync_body(st, client, start=start)
        except ValueError as exc:
            raise HTTPException(400, f"not a date: {since}") from exc
        except fitbit_mod.NotConnected as exc:
            raise HTTPException(409, str(exc)) from exc
        except fitbit_mod.NeedsReauthorization as exc:
            raise HTTPException(401, str(exc)) from exc
        except fitbit_mod.FitbitError as exc:
            raise HTTPException(502, str(exc)) from exc

    @app.post("/api/fitbit/import", response_model=FitbitImportResult)
    def fitbit_import(payload: FitbitImportRequest = Body(...)) -> dict[str, Any]:
        """Load a Google Takeout export from a path on this machine. No credential."""
        from ..ingest import fitbit_export

        try:
            with store() as st:
                return fitbit_export.import_fitbit_export(st, payload.path)
        except FileNotFoundError as exc:
            raise HTTPException(404, f"no such file: {payload.path}") from exc
        except OSError as exc:
            raise HTTPException(400, f"could not read that archive: {exc}") from exc

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
                # Null when the calendar names no race ahead (T57), which the Status
                # strip shows as no countdown rather than one to a race already run.
                "race": None if race["race"] is None else {
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
        # 20000 days (~55 years) is the shared ceiling across the windowed endpoints:
        # a bound that refuses nonsense rather than one that bounds the data. Health's
        # range control offers "All", and every endpoint it calls has to accept it.
        days: int = Query(180, ge=7, le=20000),
        metrics: str | None = Query(None, description="comma-separated metric names"),
    ) -> dict[str, Any]:
        wanted = [m.strip() for m in metrics.split(",")] if metrics else None
        if wanted:
            unknown = [m for m in wanted if m not in trends_mod.TREND_METRICS]
            if unknown:
                raise HTTPException(400, f"unknown metrics: {', '.join(unknown)}")
        with store() as st:
            return trends_mod.compute_trends(st, days=days, metrics=wanted)

    @app.get("/api/body", response_model=BodyComposition)
    # 4000 sat *below* the owner's own history: his first weigh-in is August 2014,
    # 4456 days back, so Health's "All" could not have reached it.
    def api_body(days: int = Query(540, ge=28, le=20000)) -> dict[str, Any]:
        """Weight, fat and lean mass, and what they look like against the training.

        `days` bounds the charts, not the projection: that fits its own eight-week
        window, so narrowing the view cannot change where race day lands.
        """
        with store() as st:
            return body_mod.compute_body(st, days=days)

    @app.get("/api/readiness", response_model=Readiness, response_model_exclude_unset=True)
    def api_readiness(day: str | None = None) -> dict[str, Any]:
        with store() as st:
            return ready_mod.compute_readiness(st, day)

    @app.get("/api/readiness/history", response_model=ReadinessHistory)
    def api_readiness_history(days: int = Query(90, ge=7, le=20000)) -> dict[str, Any]:
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

    @app.get("/api/race/pacing", response_model=RacePacing)
    def api_race_pacing(
        target_s: float | None = Query(None, ge=1800, le=36000),
        strategy: Literal["even", "negative"] = "even",
    ) -> dict[str, Any]:
        with store() as st:
            return pacing_mod.compute_pacing(st, settings, target_s, strategy)

    @app.get("/api/race/forecast", response_model=RaceForecast)
    def api_race_forecast() -> dict[str, Any]:
        with store() as st:
            return forecast_mod.compute_forecast(st)

    # -- training plan -------------------------------------------------------

    @app.get("/api/plan", response_model=Plan)
    def api_plan() -> dict[str, Any]:
        with store() as st:
            return plan_mod.compute_plan(st)

    @app.get("/api/plan/week", response_model=PlanWeekDetail)
    def api_plan_week(start: str = Query(..., description="any day in the week")) -> dict[str, Any]:
        try:
            date.fromisoformat(start)
        except ValueError as exc:
            raise HTTPException(422, "start must be an ISO date") from exc
        with store() as st:
            return plan_mod.compute_week(st, start)

    @app.put("/api/plan/source", response_model=Plan)
    def api_plan_subscribe(payload: PlanSourceRequest = Body(...)) -> dict[str, Any]:
        with store() as st:
            try:
                plan_ics_mod.set_source(st, payload.url, payload.label)
            except plan_ics_mod.PlanFeedError as exc:
                raise HTTPException(400, str(exc)) from exc
            return plan_mod.compute_plan(st)

    @app.get("/api/plan/sessions", response_model=PlanSessionList)
    def api_plan_sessions() -> dict[str, Any]:
        with store() as st:
            return plan_mod.compute_sessions(st)

    @app.put("/api/plan/start", response_model=Plan)
    def api_plan_start(payload: PlanStartRequest = Body(...)) -> dict[str, Any]:
        with store() as st:
            try:
                plan_ics_mod.set_start_day(st, payload.start_day)
            except plan_ics_mod.PlanFeedError as exc:
                raise HTTPException(400, str(exc)) from exc
            return plan_mod.compute_plan(st)

    @app.delete("/api/plan/source", response_model=Plan)
    def api_plan_unsubscribe() -> dict[str, Any]:
        with store() as st:
            plan_ics_mod.clear_source(st)
            return plan_mod.compute_plan(st)

    @app.post("/api/plan/sync", response_model=PlanSyncResult)
    def api_plan_sync() -> dict[str, Any]:
        with store() as st:
            try:
                return plan_ics_mod.sync_plan(st)
            except plan_ics_mod.PlanFeedError as exc:
                # The message already says what to do about it, and naming the calendar
                # is the owner's problem to fix, not a server fault.
                raise HTTPException(502, str(exc)) from exc

    @app.put("/api/plan/sessions/{session_id}/link", response_model=PlanLinkResult)
    def api_plan_link(session_id: int, payload: PlanLinkRequest = Body(...)) -> dict[str, Any]:
        with store() as st:
            try:
                return plan_mod.set_link(st, session_id, payload.activity_id, payload.ignore)
            except LookupError as exc:
                raise HTTPException(404, str(exc)) from exc
            except ValueError as exc:
                raise HTTPException(409, str(exc)) from exc

    @app.delete("/api/plan/sessions/{session_id}/link", response_model=PlanLinkResult)
    def api_plan_unlink(session_id: int) -> dict[str, Any]:
        with store() as st:
            return plan_mod.clear_link(st, session_id)

    @app.get("/api/reports", response_model=Reports)
    def api_reports() -> dict[str, Any]:
        with store() as st:
            return cached(settings, "reports", lambda: reports_mod.compute_reports(st))

    @app.get("/api/daily", response_model=DailyList)
    def api_daily(days: int = Query(400, ge=1, le=20000)) -> dict[str, Any]:
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

    # exclude_unset: with no activities, `totals` has no span keys and `streaks` no
    # span either, and they stay absent rather than becoming zeroes.
    @app.get("/api/aggregate", response_model=Aggregate, response_model_exclude_unset=True)
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

    @app.get("/api/aggregate/filters", response_model=AggregateFilters)
    def api_aggregate_filters() -> dict[str, Any]:
        with store() as st:
            return agg_mod.available_filters(st)

    @app.get("/api/aggregate/periods", response_model=AggregatePeriods)
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
            rows = preview_mod.with_card_extras(
                st,
                gym_mod.activity_rows(
                    st,
                    f"{clause} ORDER BY {sort} {order.upper()}, activity_id DESC "
                    "LIMIT ? OFFSET ?",
                    [*params, limit, offset],
                ),
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

    #: More than a page of cards is never asked for at once.
    MAX_PREVIEWS = 200

    # Declared before `/api/activities/{activity_id}`, which would otherwise take
    # "previews" for an id.
    @app.get("/api/activities/previews", response_model=ActivityPreviews)
    def api_activity_previews(ids: list[str] = Query(...)) -> dict[str, Any]:
        """The routes the activity list's cards draw, for one page of `ids`."""
        if len(ids) > MAX_PREVIEWS:
            raise HTTPException(400, f"at most {MAX_PREVIEWS} ids at once")
        with store() as st:
            return {"polylines": preview_mod.polylines(st, ids)}

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

    @app.get("/api/activities/{activity_id}/gaps", response_model=ActivityGaps)
    def api_activity_gaps(activity_id: str) -> dict[str, Any]:
        """Where the watch paused and resumed somewhere else, with a guess at the path in
        between from the rest of the rider's history. Empty for most activities."""
        with store() as st:
            if not ov_mod.activity_exists(st, activity_id):
                raise HTTPException(404, f"no activity {activity_id!r}")
            gaps = gaps_mod.activity_gaps(st, activity_id)
        out = []
        for gap in gaps:
            estimate = gap.get("estimate")
            if estimate is not None:
                path = preview_mod.simplify(estimate["path"])
                estimate = {
                    **{k: v for k, v in estimate.items() if k != "path"},
                    "lat": [p[0] for p in path],
                    "lon": [p[1] for p in path],
                }
            out.append({**{k: v for k, v in gap.items() if k != "estimate"}, "estimate": estimate})
        return {"activity_id": activity_id, "gaps": out}

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

    @app.get("/api/overrides", response_model=OverridesSummary)
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

    @app.post("/api/gear", response_model=GearItem)
    def api_gear_create(payload: GearCreateRequest = Body(...)) -> dict[str, Any]:
        with store() as st:
            try:
                attrs = gear_mod.clean_attrs(
                    payload.model_dump(exclude_unset=True), gear_mod.CREATABLE
                )
                return gear_mod.create(st, **attrs)
            except gear_mod.GearError as exc:
                raise HTTPException(400, str(exc)) from exc
            except (TypeError, ValueError) as exc:
                raise HTTPException(400, f"bad gear payload: {exc}") from exc

    @app.get("/api/gear/{gear_id}", response_model=GearDetail)
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

    @app.patch("/api/gear/{gear_id}", response_model=GearItem)
    def api_gear_update(
        gear_id: int, payload: GearWriteRequest = Body(...)
    ) -> dict[str, Any]:
        with store() as st:
            try:
                # exclude_unset, not exclude_none: "clear the nickname" is a null the
                # caller sent on purpose, and dropping it would make the field
                # unclearable.
                attrs = gear_mod.clean_attrs(
                    payload.model_dump(exclude_unset=True), gear_mod._EDITABLE
                )
                return gear_mod.update(st, gear_id, **attrs)
            except LookupError as exc:
                raise HTTPException(404, str(exc)) from exc
            except gear_mod.GearError as exc:
                raise HTTPException(400, str(exc)) from exc
            except (TypeError, ValueError) as exc:
                raise HTTPException(400, f"bad gear payload: {exc}") from exc

    @app.delete("/api/gear/{gear_id}", response_model=GearDeleted)
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

    @app.delete(
        "/api/activities/{activity_id}/gear/{gear_id}",
        response_model=ActivityGearRemoved,
    )
    def api_unassign_gear(activity_id: str, gear_id: int) -> dict[str, Any]:
        with store() as st:
            return {"removed": gear_mod.unassign(st, activity_id, gear_id)}

    @app.post("/api/gear/{gear_id}/bulk-assign", response_model=GearBulkAssignResult)
    def api_gear_bulk(
        gear_id: int,
        payload: GearBulkAssignRequest = Body(default_factory=GearBulkAssignRequest),
    ) -> dict[str, Any]:
        """Apply gear across a filtered date range — for importing gear-less history."""
        with store() as st:
            try:
                return gear_mod.bulk_assign(
                    st,
                    gear_id,
                    start=payload.start,
                    end=payload.end,
                    activity_type=payload.activity_type,
                    only_unassigned=payload.only_unassigned,
                    dry_run=payload.dry_run,
                )
            except LookupError as exc:
                raise HTTPException(404, str(exc)) from exc

    @app.post("/api/gear/defaults", response_model=GearDefaultsResult)
    def api_gear_default(payload: GearDefaultRequest = Body(...)) -> dict[str, Any]:
        with store() as st:
            try:
                return gear_mod.set_default(st, payload.activity_type, payload.gear_id)
            except LookupError as exc:
                raise HTTPException(404, str(exc)) from exc

    @app.delete(
        "/api/gear/defaults/{activity_type}/{gear_id}",
        response_model=GearDefaultCleared,
    )
    def api_gear_default_clear(activity_type: str, gear_id: int) -> dict[str, Any]:
        with store() as st:
            return {"cleared": gear_mod.clear_default(st, activity_type, gear_id)}

    # -- routes & maps -------------------------------------------------------

    @app.get("/api/routes", response_model=RouteList)
    def api_routes(type: str | None = None) -> dict[str, Any]:
        # Lap times read every attempt's track, so the list is kept until the data
        # changes, as the route pages are.
        def compute() -> dict[str, Any]:
            with store() as st:
                rows = routes_mod.list_routes(st, type)
                medians = _route_median_times(st)
                for row in rows:
                    row["median_moving_time_s"] = medians.get(int(row["route_id"]))
                return {"routes": rows}

        return cached(settings, f"routes:{type}", compute)

    @app.get("/api/routes/{route_id}/similar", response_model=RouteSimilarList)
    def api_route_similar(route_id: int) -> dict[str, Any]:
        # Scoring reads every candidate's geometry, so it is kept until the data
        # changes, as the list and the route pages are.
        def compute() -> dict[str, Any]:
            with store() as st:
                try:
                    return {"candidates": routes_mod.similar_routes(st, route_id)}
                except LookupError as exc:
                    raise HTTPException(404, str(exc)) from exc

        return cached(settings, f"route-similar:{route_id}", compute)

    @app.get("/api/routes/{route_id}", response_model=RouteDetail)
    def api_route(route_id: int) -> dict[str, Any]:
        # Lap times read every attempt's track: ~0.5 s on a route run 80 times, so
        # the answer is kept until the data changes.
        with store() as st:
            try:
                return cached(
                    settings,
                    f"route:{route_id}",
                    lambda: _columnar_route_detail(routes_mod.route_detail(st, route_id)),
                )
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
        return heatmap_cached(settings, type, start, end, precision)

    @app.post("/api/routes/recluster", response_model=ReclusterResult)
    def api_recluster(
        payload: ReclusterRequest = Body(default_factory=ReclusterRequest),
    ) -> dict[str, Any]:
        """Re-run clustering. Routes the user has pinned are left alone."""
        threshold = routes_mod.MATCH_THRESHOLD if payload.threshold is None else payload.threshold
        with store() as st:
            return routes_mod.cluster_all(st, threshold=threshold, fresh=payload.fresh)

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

    @app.get("/api/sync/estimate", response_model=SyncEstimate)
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
        if auto.running:
            raise HTTPException(409, "an automatic sync is running")

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

    @app.get("/api/sync/auto", response_model=AutoSyncStatus)
    def api_sync_auto() -> dict[str, Any]:
        """Whether the app syncs on its own, how often, and how the last run went."""
        with store() as st:
            return auto_mod.status(st, auto)

    @app.post("/api/sync/stop", response_model=SyncStopResult)
    def api_sync_stop() -> dict[str, Any]:
        return {"stopping": job.stop()}

    @app.get("/api/config", response_model=AppConfig)
    def api_config() -> dict[str, Any]:
        """Non-secret configuration, so the dashboard can label its own assumptions."""
        with store() as st:
            race = plan_mod.goal_race(st)
        return {
            # The race is the calendar's, not the deployment's (T57) — the same move
            # D12 made for the targets. Null when no race is named ahead.
            "race": race,
            "athlete": {"hr_rest": settings.hr_rest, "hr_max": settings.hr_max,
                        "sex": settings.sex},
            # No targets block: they belong to the plan, not to the deployment, and
            # are on /api/plan and /api/race (D12).
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
