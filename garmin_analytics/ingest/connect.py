"""Garmin Connect ingestion, via `garth`.

Garmin has no self-serve API for individuals — the Connect Developer Program is
enterprise-only — so this talks to the same private endpoints the mobile app uses,
authenticated by `garth`'s SSO flow. That is unofficial and can break without notice.
Consequences, honestly:

  * Endpoint paths are hard-coded literals in `ENDPOINTS` below. When Garmin moves one,
    exactly one dict entry changes.
  * Every response is archived verbatim in `raw_documents` before anything is parsed,
    so a parser fix is a re-`normalize`, not a re-fetch of 18 months.
  * Requests are paced (`REQUEST_DELAY_S`) and daily endpoints are fetched one calendar
    day at a time. Hammering this API gets accounts rate-limited.

Credentials are never stored by this module. `garth` writes an OAuth token cache to the
token directory; this module chmods it to 0700/0600 and never logs its contents.
"""

from __future__ import annotations

import logging
import os
import time
from dataclasses import dataclass
from datetime import date, timedelta
from pathlib import Path
from typing import Any, Callable, Iterable, Iterator, Mapping, Sequence

from . import normalize as norm

log = logging.getLogger("garmin_analytics.connect")

REQUEST_DELAY_S = 0.6      # be a good citizen; Garmin rate-limits aggressively
MAX_RETRIES = 3
ACTIVITY_PAGE_SIZE = 100


class ConnectError(RuntimeError):
    pass


class NotAuthenticated(ConnectError):
    pass


@dataclass(frozen=True)
class Endpoint:
    """One logical collection: how to fetch a day, and where the rows go."""

    name: str
    path: str                                   # `{date}` / `{user}` are substituted
    table: str | None
    normalizer: Callable[..., Any] | None
    per_day: bool = True


# The full set. Paths are literals on purpose — see the module docstring.
ENDPOINTS: dict[str, Endpoint] = {
    "sleep": Endpoint(
        "sleep",
        "/wellness-service/wellness/dailySleepData/{user}?date={date}&nonSleepBufferMinutes=60",
        "sleep",
        norm.normalize_sleep,
    ),
    "wellness": Endpoint(
        "wellness",
        "/usersummary-service/usersummary/daily/{user}?calendarDate={date}",
        "daily_wellness",
        norm.normalize_daily_summary,
    ),
    "hrv": Endpoint(
        "hrv",
        "/hrv-service/hrv/{date}",
        "hrv_daily",
        norm.normalize_hrv,
    ),
    "training_readiness": Endpoint(
        "training_readiness",
        "/metrics-service/metrics/trainingreadiness/{date}",
        "fitness",
        norm.normalize_training_readiness,
    ),
    "training_status": Endpoint(
        "training_status",
        "/metrics-service/metrics/trainingstatus/aggregated/{date}",
        "fitness",
        norm.normalize_training_status,
    ),
    "body": Endpoint(
        "body",
        "/weight-service/weight/dateRange?startDate={date}&endDate={date}",
        "body_composition",
        norm.normalize_weight,
    ),
}

ACTIVITIES_PATH = (
    "/activitylist-service/activities/search/activities?start={start}&limit={limit}"
)
ACTIVITY_ZONES_PATH = "/activity-service/activity/{activity_id}/hrTimeInZones"

# `fitness` is written by two endpoints, so its rows are merged before upsert.
FITNESS_ENDPOINTS = {"training_readiness", "training_status"}


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------


def _garth():
    try:
        import garth  # imported lazily so the rest of the app works without it
    except ImportError as exc:  # pragma: no cover - environment problem, not logic
        raise ConnectError("garth is not installed; run pip install -r requirements.txt") from exc
    return garth


def token_dir_is_populated(token_dir: Path) -> bool:
    return token_dir.is_dir() and any(token_dir.glob("oauth*token*.json"))


def secure_token_dir(token_dir: Path) -> None:
    """0700 on the directory, 0600 on every file inside. Never log the contents."""
    if not token_dir.exists():
        return
    os.chmod(token_dir, 0o700)
    for child in token_dir.iterdir():
        if child.is_file():
            os.chmod(child, 0o600)


def login(
    email: str,
    password: str,
    token_dir: Path,
    prompt_mfa: Callable[[], str] | None = None,
) -> None:
    """Interactive SSO login. The password is used once and never stored or logged.

    On success garth writes its OAuth1/OAuth2 token cache into `token_dir`; that cache
    is what every later run resumes from, so `login` is a once-per-year operation.
    """
    garth = _garth()
    token_dir.mkdir(parents=True, exist_ok=True)
    os.chmod(token_dir, 0o700)
    kwargs: dict[str, Any] = {}
    if prompt_mfa is not None:
        kwargs["prompt_mfa"] = prompt_mfa
    garth.login(email, password, **kwargs)
    garth.save(str(token_dir))
    secure_token_dir(token_dir)


def begin_login(email: str, password: str, token_dir: Path) -> tuple[str, Any]:
    """Start an SSO login without a terminal prompt, for the web setup screen.

    Returns either ``("ok", display_name)`` — tokens are saved and the user is in —
    or ``("mfa", client_state)``, where `client_state` must be handed back to
    `finish_login` along with the code from the user's authenticator.

    The password is used for this one call and is never stored, logged or echoed.
    `client_state` is an in-flight auth context: it is held in memory by the caller
    for a few minutes and must never be written to disk.
    """
    garth = _garth()
    token_dir.mkdir(parents=True, exist_ok=True)
    os.chmod(token_dir, 0o700)
    result = garth.login(email, password, return_on_mfa=True)
    if isinstance(result, tuple) and len(result) == 2 and result[0] == "needs_mfa":
        return "mfa", result[1]
    garth.save(str(token_dir))
    secure_token_dir(token_dir)
    return "ok", _display_name()


def finish_login(client_state: Any, code: str, token_dir: Path) -> str:
    """Complete an MFA challenge started by `begin_login`. Returns the display name."""
    garth = _garth()
    from garth import sso

    oauth1, oauth2 = sso.resume_login(client_state, str(code).strip())
    garth.client.configure(oauth1_token=oauth1, oauth2_token=oauth2)
    token_dir.mkdir(parents=True, exist_ok=True)
    os.chmod(token_dir, 0o700)
    garth.save(str(token_dir))
    secure_token_dir(token_dir)
    return _display_name()


def _display_name() -> str:
    garth = _garth()
    profile = getattr(garth.client, "profile", None) or {}
    return str(profile.get("displayName") or profile.get("userName") or "")


def logout(token_dir: Path) -> int:
    """Delete the token cache. The only way to disconnect the Garmin account."""
    removed = 0
    if token_dir.is_dir():
        for child in token_dir.glob("oauth*token*.json"):
            child.unlink()
            removed += 1
    return removed


def resume(token_dir: Path) -> str:
    """Restore a saved session. Returns the Connect display name (the API's user key)."""
    garth = _garth()
    if not token_dir_is_populated(token_dir):
        raise NotAuthenticated(
            f"No Garmin token cache in {token_dir}. Run `garmin-analytics login` first."
        )
    garth.resume(str(token_dir))
    profile = getattr(garth.client, "profile", None) or {}
    name = profile.get("displayName") or profile.get("userName")
    if not name:
        raise NotAuthenticated("Resumed a session but Garmin returned no display name.")
    return str(name)


# ---------------------------------------------------------------------------
# Transport
# ---------------------------------------------------------------------------


def fetch(path: str, retries: int = MAX_RETRIES, delay: float = REQUEST_DELAY_S) -> Any:
    """GET a Connect path and return the decoded JSON, with backoff on transport errors.

    A 404 (no data for that day) is not an error: it returns None. That happens all the
    time — the watch was off the wrist, or the metric did not exist on that firmware.
    """
    garth = _garth()
    last_exc: Exception | None = None
    for attempt in range(retries):
        try:
            time.sleep(delay)
            return garth.connectapi(path)
        except Exception as exc:  # garth raises requests' HTTPError subclasses
            status = getattr(getattr(exc, "response", None), "status_code", None)
            if status in (404, 204):
                return None
            if status == 429:
                wait = delay * (6 ** (attempt + 1))
                log.warning("rate limited; sleeping %.0fs", wait)
                time.sleep(wait)
                last_exc = exc
                continue
            if status is not None and 400 <= status < 500 and status != 408:
                raise ConnectError(f"GET {path.split('?')[0]} failed: HTTP {status}") from exc
            last_exc = exc
            time.sleep(delay * (2 ** attempt))
    raise ConnectError(f"GET {path.split('?')[0]} failed after {retries} attempts") from last_exc


def daterange(start: date, end: date) -> Iterator[date]:
    cur = start
    while cur <= end:
        yield cur
        cur += timedelta(days=1)


# ---------------------------------------------------------------------------
# Sync
# ---------------------------------------------------------------------------


def sync_daily_endpoint(
    store,
    user: str,
    endpoint: Endpoint,
    start: date,
    end: date,
    fetcher: Callable[[str], Any] = fetch,
    on_day: Callable[[str], None] | None = None,
) -> dict[str, Any]:
    """Fetch, archive and normalise one per-day endpoint across a date range."""
    written = 0
    fetched = 0
    pending_fitness: list[dict[str, Any]] = []
    last_ok: str | None = None

    for d in daterange(start, end):
        day = d.isoformat()
        path = endpoint.path.format(user=user, date=day)
        payload = fetcher(path)
        if on_day:
            on_day(day)
        if payload is None:
            continue
        fetched += 1
        raw_id = store.store_raw("connect", endpoint.name, day, payload)

        rows = endpoint.normalizer(payload, day) if endpoint.normalizer else None
        if rows is None:
            continue
        rows = rows if isinstance(rows, list) else [rows]
        for row in rows:
            if not row or not row.get("day"):
                continue
            if endpoint.name in FITNESS_ENDPOINTS:
                pending_fitness.append({**row, "raw_id": raw_id})
                continue
            store.upsert(endpoint.table, ["day"], {**row, "raw_id": raw_id})
            written += 1
        last_ok = day

    # `fitness` is fed by two endpoints; merge so neither blanks the other's columns.
    if pending_fitness:
        for day, row in norm.merge_daily(pending_fitness).items():
            existing = store.query("SELECT * FROM fitness WHERE day = ?", (day,))
            merged = {**(existing[0] if existing else {}), **{k: v for k, v in row.items() if v is not None}}
            merged.pop("rowid", None)
            store.upsert("fitness", ["day"], merged)
            written += 1

    store.set_watermark(endpoint.name, last_ok or store.get_watermark(endpoint.name), "ok")
    return {"endpoint": endpoint.name, "fetched": fetched, "written": written, "last_day": last_ok}


def sync_activities(
    store,
    start: date,
    end: date,
    fetcher: Callable[[str], Any] = fetch,
    with_zones: bool = True,
    page_size: int = ACTIVITY_PAGE_SIZE,
    max_pages: int = 200,
) -> dict[str, Any]:
    """Page backwards through the activity list until we pass `start`.

    Garmin's list endpoint is newest-first with no date filter that can be trusted, so
    paging until the dates fall out of range is the reliable approach.
    """
    written = 0
    zones_written = 0
    offset = 0
    reached_start = False
    seen: set[str] = set()

    for _ in range(max_pages):
        payload = fetcher(ACTIVITIES_PATH.format(start=offset, limit=page_size))
        if not payload:
            break
        entries = payload if isinstance(payload, list) else payload.get("activityList", [])
        if not entries:
            break

        for entry in entries:
            row = norm.normalize_activity(entry)
            aid, day = row.get("activity_id"), row.get("day")
            if not aid or not day:
                continue
            if day < start.isoformat():
                reached_start = True
                continue
            if day > end.isoformat() or aid in seen:
                continue
            seen.add(aid)

            raw_id = store.store_raw("connect", "activities", aid, entry)
            zones: dict[int, float] = {}
            if with_zones:
                zpayload = fetcher(ACTIVITY_ZONES_PATH.format(activity_id=aid))
                if zpayload:
                    store.store_raw("connect", "activity_hr_zones", aid, zpayload)
                    zones = norm.normalize_hr_zones(zpayload)

            from ..analytics import load as load_mod

            row["trimp"] = load_mod.activity_trimp(row, zones, store.settings)
            row["raw_id"] = raw_id
            store.upsert("activities", ["activity_id"], row)
            written += 1

            for zone, secs in zones.items():
                store.upsert(
                    "activity_hr_zones",
                    ["activity_id", "zone"],
                    {"activity_id": aid, "zone": zone, "seconds": secs},
                )
                zones_written += 1

        if reached_start or len(entries) < page_size:
            break
        offset += page_size

    store.set_watermark("activities", end.isoformat(), "ok")
    return {"endpoint": "activities", "written": written, "zones": zones_written}


def default_start(store, endpoint: str, lookback_days: int, end: date, overlap_days: int = 3) -> date:
    """Resume from the watermark minus a few days of overlap.

    The overlap is deliberate: Garmin backfills sleep and HRV for a day or two after
    the fact, and re-ingesting an unchanged payload is free (content-hash dedupe).
    """
    mark = store.get_watermark(endpoint)
    if mark:
        return max(date.fromisoformat(mark) - timedelta(days=overlap_days), end - timedelta(days=3650))
    return end - timedelta(days=lookback_days)


def sync(
    store,
    settings,
    days: int = 400,
    end: date | None = None,
    endpoints: Sequence[str] | None = None,
    include_activities: bool = True,
    fetcher: Callable[[str], Any] = fetch,
    user: str | None = None,
    on_progress: Callable[[str, str], None] | None = None,
) -> list[dict[str, Any]]:
    """Incremental sync. Safe to re-run: every write is an upsert keyed on day or id."""
    end = end or date.today()
    user = user or resume(settings.token_dir)
    names = list(endpoints) if endpoints else list(ENDPOINTS)
    results: list[dict[str, Any]] = []

    if include_activities:
        start = default_start(store, "activities", days, end)
        if on_progress:
            on_progress("activities", f"{start} .. {end}")
        with store.tx():
            results.append(sync_activities(store, start, end, fetcher=fetcher))

    for name in names:
        ep = ENDPOINTS[name]
        start = default_start(store, name, days, end)
        if on_progress:
            on_progress(name, f"{start} .. {end}")
        with store.tx():
            results.append(
                sync_daily_endpoint(
                    store, user, ep, start, end, fetcher=fetcher,
                    on_day=(lambda d, n=name: on_progress(n, d)) if on_progress else None,
                )
            )
    return results


def renormalize(store) -> dict[str, int]:
    """Re-parse everything already in `raw_documents`. No network access at all.

    This is the payoff of raw-first ingestion: a normaliser bug is fixed offline.
    """
    counts: dict[str, int] = {}
    with store.tx():
        for ep in ENDPOINTS.values():
            rows = store.query(
                "SELECT ref_key, payload FROM raw_documents WHERE source='connect' AND endpoint = ?",
                (ep.name,),
            )
            n = 0
            pending: list[dict[str, Any]] = []
            import json

            for r in rows:
                payload = json.loads(r["payload"])
                out = ep.normalizer(payload, r["ref_key"]) if ep.normalizer else None
                if out is None:
                    continue
                for row in out if isinstance(out, list) else [out]:
                    if not row or not row.get("day"):
                        continue
                    if ep.name in FITNESS_ENDPOINTS:
                        pending.append(row)
                    else:
                        store.upsert(ep.table, ["day"], row)
                        n += 1
            for day, row in norm.merge_daily(pending).items():
                store.upsert("fitness", ["day"], row)
                n += 1
            counts[ep.name] = n
    return counts
