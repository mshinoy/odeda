"""Full-history backfill: everything Garmin will give, back to the start of the account.

Not a recent window. For a multi-year account this is thousands of requests, so the
design constraints are the ones that matter for long jobs rather than short ones:

* **Resumable.** Progress is checkpointed to `sync_status` after *every activity*, and
  the work queue is derived from the database ("which activities have no stream yet"),
  not from an in-memory list. Kill it at request 4 000 of 6 000 and re-running picks
  up at 4 001. There is no state that only exists in the process.
* **Polite.** Every request goes through `connect.fetch`, which sleeps between calls
  and backs off exponentially on HTTP 429. `PHASE_PAUSE_S` adds a breather between
  phases. This is someone's personal account on an unofficial API; hammering it is
  both rude and the fastest way to get it locked.
* **Observable.** Progress, rate and ETA go to stdout *and* to the `sync_status` row
  the UI polls, so a backfill started from the web UI is not a black box.
* **Idempotent.** Re-running when complete is close to free: archived payloads dedupe
  on content hash and activities with streams are skipped.

Phases, in order:
  1. `activities` — page the activity list until exhausted, oldest day discovered wins.
  2. `details`    — per-activity streams (GPS, HR, cadence, altitude). The expensive one.
  3. `wellness`   — the per-day endpoints, walked across the whole account lifetime.
  4. `derive`     — best efforts and route clustering, computed locally.
"""

from __future__ import annotations

import json
import logging
import time
from datetime import date, datetime, timedelta, timezone
from typing import Any, Callable, Sequence

from . import connect as connect_mod
from . import details as details_mod

log = logging.getLogger(__name__)

JOB = "backfill"

#: Seconds to pause between phases, on top of the per-request delay.
PHASE_PAUSE_S = 2.0

#: Garmin accounts do not predate the company's consumer platform; walking daily
#: endpoints back past this is guaranteed-empty request volume.
EARLIEST_PLAUSIBLE = date(2008, 1, 1)

PHASES = ("activities", "details", "wellness", "derive")


class Cancelled(RuntimeError):
    """Raised when a caller's `should_stop` asks the backfill to stop."""


class Progress:
    """Progress accounting shared by stdout and the `sync_status` endpoint."""

    def __init__(self, store, job: str = JOB, echo: Callable[[str], None] | None = None):
        self.store = store
        self.job = job
        self.echo = echo
        self.started = time.monotonic()
        self.phase = ""
        self.done = 0
        self.total = 0

    def start(self, phase: str, total: int, message: str = "") -> None:
        self.phase = phase
        self.done = 0
        self.total = total
        self.started_phase = time.monotonic()
        self._write("running", message)
        self._say(f"[{phase}] {total} to do. {message}".rstrip())

    def step(self, n: int = 1, message: str = "", every: int = 10) -> None:
        self.done += n
        if self.done % every == 0 or self.done == self.total:
            self._write("running", message)
            self._say(
                f"[{self.phase}] {self.done}/{self.total}"
                f" ({self.pct:.0f}%) {self.rate_text} {self.eta_text} {message}".rstrip()
            )

    @property
    def pct(self) -> float:
        return 100.0 * self.done / self.total if self.total else 100.0

    @property
    def eta_s(self) -> float | None:
        elapsed = time.monotonic() - getattr(self, "started_phase", self.started)
        if self.done <= 0 or self.total <= 0:
            return None
        remaining = self.total - self.done
        return (elapsed / self.done) * remaining if remaining > 0 else 0.0

    @property
    def rate_text(self) -> str:
        elapsed = time.monotonic() - getattr(self, "started_phase", self.started)
        if elapsed <= 0 or self.done <= 0:
            return ""
        return f"{self.done / elapsed:.1f}/s"

    @property
    def eta_text(self) -> str:
        eta = self.eta_s
        if eta is None:
            return ""
        return f"ETA {timedelta(seconds=int(eta))}"

    def finish(self, state: str = "done", message: str = "") -> None:
        self.store.set_sync_status(
            self.job,
            state=state,
            phase=self.phase,
            done=self.done,
            total=self.total,
            finished_at=_now(),
            eta_s=0.0,
            message=message,
        )
        self._say(f"[{self.phase}] {state}. {message}".rstrip())

    def _write(self, state: str, message: str) -> None:
        self.store.set_sync_status(
            self.job,
            state=state,
            phase=self.phase,
            done=self.done,
            total=self.total,
            eta_s=self.eta_s,
            message=message,
        )

    def _say(self, text: str) -> None:
        if self.echo:
            self.echo(text)


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def status(store, job: str = JOB) -> dict[str, Any]:
    """What the UI polls. Always returns a shape, even before a run has happened."""
    row = store.sync_status(job) or {}
    cursor = {}
    if row.get("cursor"):
        try:
            cursor = json.loads(row["cursor"])
        except (TypeError, ValueError):
            cursor = {}
    done, total = int(row.get("done") or 0), row.get("total")
    return {
        "job": job,
        "state": row.get("state") or "idle",
        "phase": row.get("phase"),
        "done": done,
        "total": int(total) if total else None,
        "pct": round(100.0 * done / int(total), 1) if total else None,
        "eta_s": row.get("eta_s"),
        "eta": (
            str(timedelta(seconds=int(row["eta_s"])))
            if row.get("eta_s") not in (None, "")
            else None
        ),
        "message": row.get("message"),
        "started_at": row.get("started_at"),
        "updated_at": row.get("updated_at"),
        "finished_at": row.get("finished_at"),
        "cursor": cursor,
        "phases": list(PHASES),
    }


def is_running(store, job: str = JOB, stale_after_s: float = 300.0) -> bool:
    """True if a backfill looks alive.

    A row left saying "running" by a killed process would otherwise block every
    future run, so a checkpoint older than `stale_after_s` counts as dead.
    """
    row = store.sync_status(job)
    if not row or row.get("state") != "running":
        return False
    updated = row.get("updated_at")
    if not updated:
        return False
    try:
        ts = datetime.strptime(str(updated), "%Y-%m-%dT%H:%M:%SZ")
    except ValueError:
        return True
    return (datetime.now(timezone.utc) - ts.replace(tzinfo=timezone.utc)
            ).total_seconds() < stale_after_s


# ---------------------------------------------------------------------------
# Phases
# ---------------------------------------------------------------------------


def backfill_activities(
    store,
    fetcher: Callable[[str], Any],
    progress: Progress,
    page_size: int = 100,
    max_pages: int = 2000,
    should_stop: Callable[[], bool] | None = None,
) -> dict[str, Any]:
    """Page the activity list from newest to oldest until Garmin runs out.

    No date bound: the whole point is to reach the beginning of the account. The
    page offset is checkpointed so an interrupted walk resumes mid-list.
    """
    from ..analytics import load as load_mod
    from . import normalize as norm

    written = 0
    pages = 0
    oldest: str | None = None
    offset = int((status(store)["cursor"] or {}).get("activity_offset") or 0)

    progress.start("activities", 0, f"paging the activity list from offset {offset}")
    while pages < max_pages:
        if should_stop and should_stop():
            raise Cancelled("stopped during activity paging")
        payload = fetcher(
            connect_mod.ACTIVITIES_PATH.format(start=offset, limit=page_size)
        )
        entries = (
            payload
            if isinstance(payload, list)
            else (payload or {}).get("activityList", [])
        )
        if not entries:
            break

        for entry in entries:
            row = norm.normalize_activity(entry)
            aid, day = row.get("activity_id"), row.get("day")
            if not aid or not day:
                continue
            raw_id = store.store_raw("connect", "activities", aid, entry)
            row["trimp"] = load_mod.activity_trimp(row, {}, store.settings)
            row["raw_id"] = raw_id
            store.upsert("activities", ["activity_id"], row)
            written += 1
            if oldest is None or day < oldest:
                oldest = day

        pages += 1
        offset += len(entries)
        progress.total = offset
        progress.step(len(entries), f"oldest so far {oldest}", every=1)
        store.set_sync_status(
            JOB, cursor=json.dumps({"activity_offset": offset, "oldest_day": oldest})
        )
        store.conn.commit()
        if len(entries) < page_size:
            break

    # The walk is complete: clear the offset so the next run starts from the top and
    # picks up anything recorded since.
    store.set_sync_status(JOB, cursor=json.dumps({"oldest_day": oldest}))
    store.set_watermark("activities", date.today().isoformat(), "ok", "backfill")
    return {"activities": written, "pages": pages, "oldest_day": oldest}


def backfill_details(
    store,
    fetcher: Callable[[str], Any],
    progress: Progress,
    limit: int | None = None,
    should_stop: Callable[[], bool] | None = None,
) -> dict[str, Any]:
    """Fetch the per-activity stream for every activity that has not got one.

    This is the long pole. The queue comes from the database, and a checkpoint is
    written after each activity, so this phase is interruptible at any point.
    """
    queue = details_mod.activities_missing_samples(store, limit)
    progress.start("details", len(queue), "fetching per-activity streams")
    if not queue:
        return {"fetched": 0, "samples": 0, "gps": 0, "remaining": 0}

    fetched = samples = with_gps = failed = 0
    for i, aid in enumerate(queue, 1):
        if should_stop and should_stop():
            raise Cancelled(f"stopped after {i - 1} of {len(queue)} activity details")
        try:
            result = details_mod.sync_activity_details(store, aid, fetcher)
            fetched += 1
            samples += result["samples"]
            with_gps += 1 if result.get("gps") else 0
        except connect_mod.ConnectError as exc:
            # One bad activity must not end a six-thousand-request job.
            failed += 1
            log.warning("details failed for %s: %s", aid, exc)

        # Checkpoint after EVERY activity: that is what makes resume exact.
        store.set_sync_status(
            JOB,
            cursor=json.dumps({"last_activity": aid, "phase": "details"}),
        )
        progress.step(1, f"{with_gps} with GPS, {failed} failed")

    return {
        "fetched": fetched,
        "samples": samples,
        "gps": with_gps,
        "failed": failed,
        "remaining": len(details_mod.activities_missing_samples(store)),
    }


def backfill_wellness(
    store,
    user: str,
    fetcher: Callable[[str], Any],
    progress: Progress,
    start: date,
    end: date,
    endpoints: Sequence[str] | None = None,
    should_stop: Callable[[], bool] | None = None,
) -> dict[str, Any]:
    """Walk every per-day endpoint across the account's whole lifetime."""
    names = list(endpoints) if endpoints else list(connect_mod.ENDPOINTS)
    days = (end - start).days + 1
    progress.start(
        "wellness", days * len(names), f"{days} days x {len(names)} endpoints"
    )

    results: dict[str, Any] = {}
    for name in names:
        endpoint = connect_mod.ENDPOINTS[name]
        # Resume per endpoint: a watermark inside the requested span means this
        # endpoint was already walked up to there.
        mark = store.get_watermark(name)
        ep_start = start
        if mark:
            try:
                marked = date.fromisoformat(mark)
                if start <= marked <= end:
                    ep_start = marked
            except ValueError:
                pass
        skipped = (ep_start - start).days
        if skipped > 0:
            progress.step(skipped, f"{name}: resuming at {ep_start}", every=1)

        if should_stop and should_stop():
            raise Cancelled(f"stopped before {name}")
        results[name] = connect_mod.sync_daily_endpoint(
            store, user, endpoint, ep_start, end, fetcher,
            on_day=lambda day, n=name: progress.step(1, f"{n} {day}", every=25),
        )
        time.sleep(PHASE_PAUSE_S)
    return results


def derive(store, progress: Progress) -> dict[str, Any]:
    """Local post-processing: best efforts, then route clustering. No network."""
    from ..analytics import performance as perf
    from ..analytics import routes as routes_mod

    progress.start("derive", 2, "recomputing best efforts and routes")
    efforts = perf.rebuild_best_efforts(store)
    progress.step(1, f"{efforts} best efforts")
    clustered = routes_mod.cluster_all(
        store, progress=lambda msg: progress._say(f"[derive] {msg}")
    )
    progress.step(1, f"{clustered['routes']} routes")
    return {"best_efforts": efforts, **clustered}


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------


def run(
    store,
    settings,
    fetcher: Callable[[str], Any] | None = None,
    user: str | None = None,
    end: date | None = None,
    since: date | None = None,
    phases: Sequence[str] = PHASES,
    detail_limit: int | None = None,
    echo: Callable[[str], None] | None = print,
    should_stop: Callable[[], bool] | None = None,
) -> dict[str, Any]:
    """Run a full backfill. Safe to interrupt and safe to re-run."""
    fetcher = fetcher or connect_mod.fetch
    end = end or date.today()
    progress = Progress(store, JOB, echo)
    store.set_sync_status(
        JOB, state="running", phase="starting", done=0, total=0,
        started_at=_now(), finished_at=None, message="backfill started",
    )

    out: dict[str, Any] = {"phases": {}}
    try:
        if user is None and ("wellness" in phases):
            user = connect_mod.resume(settings.token_dir)

        if "activities" in phases:
            out["phases"]["activities"] = backfill_activities(
                store, fetcher, progress, should_stop=should_stop
            )
            time.sleep(PHASE_PAUSE_S)

        if "details" in phases:
            out["phases"]["details"] = backfill_details(
                store, fetcher, progress, detail_limit, should_stop=should_stop
            )
            time.sleep(PHASE_PAUSE_S)

        if "wellness" in phases:
            start = since or account_start(store, end)
            out["phases"]["wellness"] = backfill_wellness(
                store, user or "", fetcher, progress, start, end,
                should_stop=should_stop,
            )

        if "derive" in phases:
            out["phases"]["derive"] = derive(store, progress)

        progress.finish("done", "backfill complete")
        out["state"] = "done"
    except Cancelled as exc:
        progress.finish("cancelled", str(exc))
        out["state"] = "cancelled"
        out["error"] = str(exc)
    except Exception as exc:
        progress.finish("error", f"{type(exc).__name__}: {exc}")
        out["state"] = "error"
        out["error"] = str(exc)
        raise
    return out


def account_start(store, end: date | None = None) -> date:
    """The earliest day worth asking about: the oldest activity we know of.

    Falls back to ten years so a brand-new database still fetches a real history
    rather than nothing, and is floored at `EARLIEST_PLAUSIBLE`.
    """
    end = end or date.today()
    oldest = store.scalar("SELECT MIN(day) FROM activities")
    if oldest:
        try:
            return max(date.fromisoformat(str(oldest)[:10]), EARLIEST_PLAUSIBLE)
        except ValueError:
            pass
    return max(end - timedelta(days=3650), EARLIEST_PLAUSIBLE)


def estimate(store, end: date | None = None) -> dict[str, Any]:
    """Rough size of the job, so the user is told before they start it.

    Deliberately reported as a range: the per-request delay dominates and Garmin's
    throttling is not predictable.
    """
    end = end or date.today()
    start = account_start(store, end)
    days = (end - start).days + 1
    pending = len(details_mod.activities_missing_samples(store))
    endpoints = len(connect_mod.ENDPOINTS)
    requests = pending + days * endpoints
    per_request = max(connect_mod.REQUEST_DELAY_S, 0.2)
    seconds = requests * per_request
    return {
        "first_day": start.isoformat(),
        "last_day": end.isoformat(),
        "days": days,
        "activities_pending_details": pending,
        "daily_endpoints": endpoints,
        "estimated_requests": requests,
        "estimated_seconds_low": round(seconds),
        "estimated_seconds_high": round(seconds * 2.5),
        "estimated_low": str(timedelta(seconds=int(seconds))),
        "estimated_high": str(timedelta(seconds=int(seconds * 2.5))),
    }
