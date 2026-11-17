"""Keeping the data current without anyone pressing Sync.

Both sources are pull-only: Garmin Connect and Google Health hand over what is asked for
and never push. Before this, the data was exactly as old as the last time somebody
remembered the button — eleven days, the morning this was written.

What a run does, and deliberately no more:

* **Garmin** — the incremental `connect.sync`, which resumes every endpoint from its
  watermark with a few days of overlap (Garmin back-fills sleep and HRV after the
  fact). Then streams for any activity that has none yet, capped per run, and the local
  derive steps *only if something new arrived*: best efforts cost seconds, route
  clustering half a minute on a 2-CPU box, and neither has anything to do on a run that
  found nothing. Then the watch's laps for the newest activities that have none, capped
  the same way, so a structured workout shows its intervals the morning after.
* **Google Health** — `sync_body`, which resumes from its own watermark.

Each source is skipped quietly when it is not connected, and a failure in one is
recorded without stopping the other. Nothing here retries in a loop: a run that fails
is reported in Settings and tried again at the next interval, so an expired session
costs one failed run every few hours, not a hammering.

The schedule is **measured from the last run, which is in the database**, not from when
the process started. A redeploy does not reset the clock, and a server that starts with
a run overdue catches up shortly after boot.
"""

from __future__ import annotations

import json
import logging
import threading
import time
from datetime import datetime, timezone
from typing import Any, Callable

from . import connect as connect_mod
from . import details as details_mod
from . import laps as laps_mod

log = logging.getLogger("odeda.auto_sync")

#: The `sync_status` row this writes. Its own row, so an automatic run never overwrites
#: the backfill's progress that the Sync panel reads.
JOB = "auto"

#: D8 in docs/history/PLAN-HISTORY.md: four light runs a day.
DEFAULT_INTERVAL_HOURS = 6.0

#: How long after boot before the first check. Long enough for the server to be up and
#: answering before a sync starts competing with it for the CPU.
STARTUP_DELAY_S = 120.0

#: How often a waiting scheduler re-reads when the next run is due. A run started some
#: other way moves that time, so the wait is checked in slices rather than slept in one.
POLL_S = 300.0

#: When a manual sync holds the network, how long before trying again.
BUSY_RETRY_S = 600.0

#: Activity streams fetched per run. New activities are a handful a day; this bounds a
#: run if history ever has a hole in it, which then fills a little each run.
DETAIL_LIMIT = 25


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _epoch(stamp: str | None) -> float | None:
    if not stamp:
        return None
    try:
        return datetime.strptime(stamp, "%Y-%m-%dT%H:%M:%SZ").replace(
            tzinfo=timezone.utc
        ).timestamp()
    except ValueError:
        return None


def _stamp(epoch: float) -> str:
    return datetime.fromtimestamp(epoch, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ---------------------------------------------------------------------------
# One run
# ---------------------------------------------------------------------------


def sync_garmin(
    store,
    settings,
    fetcher: Callable[[str], Any] | None = None,
    resume: Callable[[Any], str] = connect_mod.resume,
) -> dict[str, Any]:
    """The incremental Garmin sync, the streams it uncovered, and derive if needed."""
    if not connect_mod.token_dir_is_populated(settings.token_dir):
        return {"state": "skipped", "message": "Garmin is not connected."}
    try:
        user = resume(settings.token_dir)
    except connect_mod.NotAuthenticated as exc:
        return {"state": "error", "message": str(exc)}

    fetcher = fetcher or connect_mod.fetch
    before = int(store.scalar("SELECT COUNT(*) FROM activities") or 0)
    connect_mod.sync(store, settings, user=user, fetcher=fetcher)
    new = int(store.scalar("SELECT COUNT(*) FROM activities") or 0) - before

    streams = gps = failed = 0
    for aid in details_mod.activities_missing_samples(store, DETAIL_LIMIT):
        try:
            result = details_mod.sync_activity_details(store, aid, fetcher)
        except connect_mod.ConnectError as exc:
            # One bad activity must not cost the rest of the run.
            failed += 1
            log.warning("auto-sync: details failed for %s: %s", aid, exc)
            continue
        streams += 1
        gps += 1 if result.get("gps") else 0

    laps = 0
    for aid in laps_mod.activities_missing_laps(store, DETAIL_LIMIT):
        try:
            laps_mod.sync_activity_laps(store, aid, fetcher)
        except connect_mod.ConnectError as exc:
            log.warning("auto-sync: laps failed for %s: %s", aid, exc)
            continue
        laps += 1
    # Plans for runs whose laps arrived before plans were fetched, or whose plan failed.
    for aid in laps_mod.activities_missing_workout(store, DETAIL_LIMIT):
        try:
            laps_mod.sync_activity_workout(store, aid, fetcher)
        except connect_mod.ConnectError as exc:
            log.warning("auto-sync: workout plan failed for %s: %s", aid, exc)

    if new or streams:
        from ..analytics import performance as perf_mod

        perf_mod.rebuild_best_efforts(store)
    if gps:
        from ..analytics import routes as routes_mod

        routes_mod.cluster_all(store)

    parts = [f"{new} new activit{'y' if new == 1 else 'ies'}"]
    if streams:
        parts.append(f"{streams} stream{'' if streams == 1 else 's'}")
    if failed:
        parts.append(f"{failed} stream{'' if failed == 1 else 's'} failed")
    if laps:
        parts.append(f"laps for {laps} activit{'y' if laps == 1 else 'ies'}")
    return {
        "state": "done",
        "message": ", ".join(parts) + ".",
        "new_activities": new,
        "streams": streams,
    }


def sync_fitbit(
    store,
    settings,
    client_factory: Callable[[Any], Any] | None = None,
) -> dict[str, Any]:
    """Google Health weigh-ins, from the watermark."""
    from . import fitbit as fitbit_mod
    from . import fitbit_sync as fitbit_sync_mod

    if not fitbit_mod.is_connected(settings.token_dir):
        return {"state": "skipped", "message": "Google Health is not connected."}
    factory = client_factory or fitbit_mod.FitbitClient.resume
    try:
        result = fitbit_sync_mod.sync_body(store, factory(settings.token_dir))
    except fitbit_mod.FitbitError as exc:
        return {"state": "error", "message": str(exc)}

    if result["state"] == "rate_limited":
        # Not a failure: the place is kept and the next run carries on from it.
        return {"state": "done", "message": "Rate limited; the next run carries on.",
                "weigh_ins": 0}
    n = int(result["days_written"])
    return {
        "state": "done",
        "message": f"{n} weigh-in{'' if n == 1 else 's'} through {result.get('last_day')}.",
        "weigh_ins": n,
    }


def sync_plan(store, settings) -> dict[str, Any]:
    """The training calendar, if one is subscribed.

    Last of the three deliberately: it is the only source whose usefulness depends on
    another having run. Adherence is judged against activities, so reading the calendar
    before Garmin has been pulled would score this morning's long run as missed until
    the next run six hours later.
    """
    from . import plan_ics as plan_mod

    try:
        result = plan_mod.sync_plan(store)
    except plan_mod.PlanFeedError as exc:
        # The message already names the likely cause — usually a reset secret address.
        return {"state": "error", "message": str(exc)}

    if result["status"] == "skipped":
        return {"state": "skipped", "message": "No training calendar is subscribed."}
    if result["status"] == "unchanged":
        # A 304 is a good run that wrote nothing, not a failure and not silence.
        return {"state": "done", "message": "Training plan unchanged.", "sessions": 0}

    n = int(result["sessions"])
    extra = ""
    if result.get("withdrawn"):
        extra += f" {result['withdrawn']} no longer in the calendar."
    if result.get("parsed_unparsed"):
        extra += f" {result['parsed_unparsed']} could not be read."
    return {
        "state": "done",
        "message": f"{n} prescribed session{'' if n == 1 else 's'}.{extra}",
        "sessions": n,
    }


def sync_weather(store, settings) -> dict[str, Any]:
    """Weather for activities that have none, from Open-Meteo; nothing to set up."""
    from . import weather as weather_mod

    result = weather_mod.sync_weather(store)
    # Nothing to look up is the usual run, and says nothing in the status line.
    if result["state"] == "done" and not result["fetched"] and not result["left"]:
        return {"state": "skipped", "message": result["message"]}
    return result


def run_once(
    store,
    settings,
    garmin: Callable[[Any, Any], dict[str, Any]] = sync_garmin,
    fitbit: Callable[[Any, Any], dict[str, Any]] = sync_fitbit,
    plan: Callable[[Any, Any], dict[str, Any]] = sync_plan,
    weather: Callable[[Any, Any], dict[str, Any]] = sync_weather,
) -> dict[str, Any]:
    """Every source, one after the other, recorded in the `auto` row of `sync_status`."""
    store.set_sync_status(
        JOB, state="running", phase="garmin", done=0, total=4,
        started_at=_now(), finished_at=None, message="automatic sync started",
    )
    sources: dict[str, dict[str, Any]] = {}
    for done, (name, step) in enumerate((("garmin", garmin), ("fitbit", fitbit), ("plan", plan), ("weather", weather))):
        store.set_sync_status(JOB, phase=name, done=done)
        try:
            sources[name] = step(store, settings)
        except Exception as exc:  # recorded, never raised into the scheduler thread
            log.exception("auto-sync: %s failed", name)
            sources[name] = {"state": "error", "message": f"{type(exc).__name__}: {exc}"}

    errors = [n for n, r in sources.items() if r["state"] == "error"]
    if errors:
        state, message = "error", "; ".join(sources[n]["message"] for n in errors)
    elif all(r["state"] == "skipped" for r in sources.values()):
        state, message = "done", "Nothing is connected."
    else:
        state = "done"
        message = " ".join(r["message"] for r in sources.values() if r["state"] == "done")
    store.set_sync_status(
        JOB, state=state, phase="", done=4, finished_at=_now(), message=message,
        cursor=json.dumps(sources),
    )
    return {"state": state, "message": message, "sources": sources}


def last_run(store) -> dict[str, Any] | None:
    return store.sync_status(JOB)


def next_due(store, interval_s: float, now: float) -> float:
    """When the next run is due: the interval after the last one, or now if there was none.

    Measured from when the last run *finished*; a run that never finished (the process
    died in it) counts from when it started, so a crash does not stall the schedule.
    """
    row = last_run(store) or {}
    last = _epoch(row.get("finished_at")) or _epoch(row.get("started_at"))
    return now if last is None else last + interval_s


# ---------------------------------------------------------------------------
# The scheduler
# ---------------------------------------------------------------------------


class AutoSync:
    """A daemon thread that runs `run_once` every `interval_hours`.

    Single-tenant, one process: a thread and an event are the whole mechanism, as for
    the backfill. `is_busy` reports a manual sync in progress; a due run waits for it
    rather than running alongside it.
    """

    def __init__(
        self,
        settings,
        interval_hours: float,
        is_busy: Callable[[], bool] = lambda: False,
        run: Callable[[Any, Any], dict[str, Any]] = run_once,
        clock: Callable[[], float] = time.time,
        startup_delay_s: float = STARTUP_DELAY_S,
        poll_s: float = POLL_S,
    ) -> None:
        self.settings = settings
        self.interval_s = max(0.0, float(interval_hours)) * 3600.0
        self.is_busy = is_busy
        self._run = run
        self.clock = clock
        self.startup_delay_s = startup_delay_s
        self.poll_s = poll_s
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._not_before = 0.0

    @property
    def enabled(self) -> bool:
        return self.interval_s > 0

    @property
    def running(self) -> bool:
        """Whether a run is in progress right now."""
        return self._lock.locked()

    def due_at(self, store) -> float | None:
        if not self.enabled:
            return None
        return max(next_due(store, self.interval_s, self.clock()), self._not_before)

    def start(self) -> None:
        if not self.enabled or (self._thread and self._thread.is_alive()):
            return
        self._stop.clear()
        self._not_before = self.clock() + self.startup_delay_s
        self._thread = threading.Thread(target=self._loop, name="ga-auto-sync", daemon=True)
        self._thread.start()

    def stop(self, timeout: float | None = 5.0) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout)

    def run_now(self) -> dict[str, Any] | None:
        """Run once if nothing else is syncing. None when it did not run."""
        from ..db.store import Store

        if not self._lock.acquire(blocking=False):
            return None
        try:
            if self.is_busy():
                self._not_before = self.clock() + BUSY_RETRY_S
                return None
            with Store.open(self.settings) as store:
                return self._run(store, self.settings)
        finally:
            self._lock.release()

    def _loop(self) -> None:
        from ..db.store import Store

        while not self._stop.is_set():
            try:
                with Store.open(self.settings) as store:
                    due = self.due_at(store)
            except Exception:  # pragma: no cover - a database that will not open
                log.exception("auto-sync: could not read the schedule")
                due = self.clock() + self.poll_s
            wait = (due or 0.0) - self.clock()
            if wait > 0:
                self._stop.wait(min(wait, self.poll_s))
                continue
            try:
                self.run_now()
            except Exception:  # pragma: no cover - run_once records its own failures
                log.exception("auto-sync: run failed")
                self._not_before = self.clock() + self.poll_s


#: The watermark that moves when each source syncs, however it was started.
SOURCE_WATERMARKS = {"garmin": "activities", "fitbit": "fitbit_body", "plan": "plan"}


def _resolved_since(store, sources: dict[str, Any], finished_at: str | None) -> None:
    """Clear a failure that a later successful sync has already fixed.

    Without this, reconnecting Google Health and syncing by hand still left Settings
    showing the automatic run's error until the next run, hours later.
    """
    for name, result in sources.items():
        mark = SOURCE_WATERMARKS.get(name)
        if result.get("state") != "error" or not mark or not finished_at:
            continue
        row = store.query(
            "SELECT last_run_at, status FROM sync_watermark WHERE endpoint = ?", (mark,)
        )
        if row and row[0]["status"] == "ok" and (row[0]["last_run_at"] or "") > finished_at:
            sources[name] = {"state": "done", "message": "Synced since, without a problem."}


def status(store, scheduler: AutoSync) -> dict[str, Any]:
    """What Settings shows: on or off, how often, the last run and the next."""
    row = last_run(store) or {}
    due = scheduler.due_at(store)
    try:
        sources = json.loads(row["cursor"]) if row.get("cursor") else {}
    except ValueError:
        sources = {}
    _resolved_since(store, sources, row.get("finished_at"))
    return {
        "enabled": scheduler.enabled,
        "interval_hours": scheduler.interval_s / 3600.0,
        "running": scheduler.running,
        "state": row.get("state"),
        "message": row.get("message"),
        "started_at": row.get("started_at"),
        "finished_at": row.get("finished_at"),
        "next_run_at": _stamp(due) if due is not None else None,
        "sources": sources,
    }
