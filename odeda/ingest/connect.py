"""Garmin Connect ingestion, via `python-garminconnect`.

Garmin has no self-serve API for individuals — the Connect Developer Program is
enterprise-only — so this talks to the same private endpoints the mobile app uses,
authenticated by `garminconnect`'s SSO flow. That is unofficial and can break without
notice. Consequences, honestly:

  * Endpoint paths are hard-coded literals in `ENDPOINTS` below. When Garmin moves one,
    exactly one dict entry changes.
  * Every response is archived verbatim in `raw_documents` before anything is parsed,
    so a parser fix is a re-`normalize`, not a re-fetch of 18 months.
  * Requests are paced (`REQUEST_DELAY_S`) and daily endpoints are fetched one calendar
    day at a time. Hammering this API gets accounts rate-limited.

Why this library and not `garth`: Garmin fingerprints the client on the login route and
answers anything script-shaped with 429/503, which is what got garth deprecated
(matin/garth#222). Pinning one impersonation profile only moved the goalposts — the
profile went stale and the 503 came back. `garminconnect` carries a cascading chain of
five login strategies (iOS mobile over curl_cffi, mobile over requests, the sign-in
widget, and two portal flows) and falls through to the next one on a rate-limit or a bot
challenge, so a single edge change no longer takes the login down. See docs/history/DECISIONS.md D3.

Credentials are never stored by this module. The library writes a token cache to the
token directory; this module chmods it to 0700/0600 and never logs its contents.
"""

from __future__ import annotations

import logging
import os
import re
import time
from dataclasses import dataclass
from datetime import date, timedelta
from pathlib import Path
from typing import Any, Callable, Iterator, Sequence
from urllib.parse import parse_qsl, quote

from . import normalize as norm

log = logging.getLogger("odeda.connect")

REQUEST_DELAY_S = 0.6      # be a good citizen; Garmin rate-limits aggressively
MAX_RETRIES = 3
ACTIVITY_PAGE_SIZE = 100


class ConnectError(RuntimeError):
    pass


class NotAuthenticated(ConnectError):
    pass


class InvalidTicket(ConnectError, ValueError):
    """Pasted text with no ticket in it. A `ValueError` as well as a `ConnectError`
    so the API answers 400 — the user mispasted — instead of blaming Garmin with a
    502, while `except ConnectError` in the CLI keeps working."""


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

#: The library writes exactly this file inside the token directory. Named here rather
#: than globbed so `logout` cannot be talked into deleting anything else on the volume.
TOKEN_FILENAME = "garmin_tokens.json"

#: The one authenticated client for this process. Every call goes through
#: `_client()`, so a resumed session is reused instead of re-authenticating per request.
_CLIENT: Any = None


def _garminconnect():
    try:
        import garminconnect  # imported lazily so the rest of the app works without it
    except ImportError as exc:  # pragma: no cover - environment problem, not logic
        raise ConnectError(
            "garminconnect is not installed; run pip install -r requirements.txt"
        ) from exc
    return garminconnect


def _client() -> Any:
    """The authenticated client, or a clear error saying how to get one."""
    if _CLIENT is None:
        raise NotAuthenticated(
            "No Garmin session in this process. Call resume() (or log in) first."
        )
    return _CLIENT


def _new_client(**kwargs: Any) -> Any:
    """A fresh client. `verify_login` stays on: a token the API tier rejects is no
    token, and finding that out at login time beats finding out mid-backfill."""
    return _garminconnect().Garmin(**kwargs)


def _set_client(client: Any) -> None:
    global _CLIENT
    _CLIENT = client


def token_file(token_dir: Path) -> Path:
    return token_dir / TOKEN_FILENAME


def token_dir_is_populated(token_dir: Path) -> bool:
    return token_file(token_dir).is_file()


def secure_token_dir(token_dir: Path) -> None:
    """0700 on the directory, 0600 on every file inside. Never log the contents.

    The library already writes with those modes; this re-asserts them, which is what
    makes a cache written by an older release (or restored from a backup) safe to keep.
    """
    if not token_dir.exists():
        return
    os.chmod(token_dir, 0o700)
    for child in token_dir.iterdir():
        if child.is_file():
            os.chmod(child, 0o600)


def _prepare_token_dir(token_dir: Path) -> None:
    token_dir.mkdir(parents=True, exist_ok=True)
    os.chmod(token_dir, 0o700)


def _clear_token_file(token_dir: Path) -> None:
    """Drop any cached tokens so a credential login really runs.

    `Garmin.login(tokenstore=...)` resumes from the cache when one is there and only
    falls back to the password. Someone re-running `login` is telling us the cache is
    not good enough, so it goes first.
    """
    token_file(token_dir).unlink(missing_ok=True)


def _save(client: Any, token_dir: Path) -> None:
    client.client.dump(str(token_dir))
    secure_token_dir(token_dir)


def login(
    email: str,
    password: str,
    token_dir: Path,
    prompt_mfa: Callable[[], str] | None = None,
) -> None:
    """Interactive SSO login. The password is used once and never stored or logged.

    On success the library writes its token cache into `token_dir`; that cache is what
    every later run resumes from, so `login` is a once-per-year operation.
    """
    _prepare_token_dir(token_dir)
    _clear_token_file(token_dir)
    client = _new_client(email=email, password=password, prompt_mfa=prompt_mfa)
    client.login(tokenstore=str(token_dir))
    secure_token_dir(token_dir)
    _set_client(client)


def begin_login(email: str, password: str, token_dir: Path) -> tuple[str, Any]:
    """Start an SSO login without a terminal prompt, for the web setup screen.

    Returns either ``("ok", display_name)`` — tokens are saved and the user is in —
    or ``("mfa", client_state)``, where `client_state` must be handed back to
    `finish_login` along with the code from the user's authenticator.

    The password is used for this one call and is never stored, logged or echoed.
    `client_state` is the in-flight client itself: the MFA challenge lives inside it,
    so it is held in memory by the caller for a few minutes and must never be written
    to disk.
    """
    _prepare_token_dir(token_dir)
    _clear_token_file(token_dir)
    client = _new_client(email=email, password=password, return_on_mfa=True)
    status, _ = client.login(tokenstore=str(token_dir))
    if status == "needs_mfa":
        return "mfa", client
    _save(client, token_dir)
    _set_client(client)
    return "ok", _display_name(client)


def finish_login(client_state: Any, code: str, token_dir: Path) -> str:
    """Complete an MFA challenge started by `begin_login`. Returns the display name.

    `client_state` is the client `begin_login` returned — the pending challenge is held
    on that instance, so finishing on a different one would just start over.
    """
    client = client_state
    client.resume_login(None, str(code).strip())
    _prepare_token_dir(token_dir)
    _save(client, token_dir)
    _set_client(client)
    return _display_name(client)


#: The profile document that carries the display name. That name is the user key in
#: half the endpoint paths, so nothing can sync until it is known.
SOCIAL_PROFILE_PATH = "/userprofile-service/socialProfile"


def _display_name(client: Any) -> str:
    """The Connect display name, fetching the profile if the login left it unset.

    A login that returns early on MFA skips the library's profile load, so the
    attribute is empty on exactly the path the web setup screen takes.
    """
    name = getattr(client, "display_name", None)
    if not name:
        profile = client.connectapi(SOCIAL_PROFILE_PATH) or {}
        name = profile.get("displayName") or profile.get("userName") if isinstance(profile, dict) else None
        if name:
            client.display_name = name
    return str(name or "")


# ---------------------------------------------------------------------------
# Browser-ticket login
# ---------------------------------------------------------------------------
#
# The password login is expected to work again now that the library cascades through
# five strategies, so this is a fallback rather than the main road. It is kept because
# it is the one path that does not depend on any of them: Garmin's edge can decide every
# scripted login looks wrong, and a real browser still signs in.
#
# Garmin's CAS hands out a service ticket (`ST-…`) on successful sign-in, and exchanging
# that ticket for tokens is an ordinary API call. So the browser does the part only a
# browser can do, and we do the rest. The user signs in wherever they already have a
# session, copies the ticket out of the redirect URL, and we exchange it here. No
# password ever reaches this process.

#: A CAS ticket is issued **for one service URL** and is worthless against any other —
#: the exchange sends this value back and Garmin checks it matches. So the sign-in URL is
#: built from this constant rather than repeating the literal, and `login_with_ticket`
#: passes the same constant. They cannot drift apart without a test failing.
SIGNIN_SERVICE_URL = "https://sso.garmin.com/sso/embed"

SIGNIN_URL = (
    "https://sso.garmin.com/sso/signin"
    "?id=gauth-widget"
    "&embedWidget=true"
    "&gauthHost=" + quote("https://sso.garmin.com/sso", safe="") +
    "&service=" + quote(SIGNIN_SERVICE_URL, safe="") +
    "&source=" + quote(SIGNIN_SERVICE_URL, safe="") +
    "&redirectAfterAccountLoginUrl=" + quote(SIGNIN_SERVICE_URL, safe="") +
    "&redirectAfterAccountCreationUrl=" + quote(SIGNIN_SERVICE_URL, safe="")
)

_TICKET_RE = re.compile(r"(ST-[A-Za-z0-9._-]+)")


def extract_ticket(pasted: str) -> str:
    """Pull the service ticket out of whatever the user pasted.

    They may paste the bare ticket or the whole redirect URL; both are common and
    telling someone their URL is the wrong shape helps nobody.
    """
    match = _TICKET_RE.search((pasted or "").strip())
    if not match:
        raise InvalidTicket(
            "No Garmin ticket found in that text. After signing in, the address bar "
            "ends with `?ticket=ST-…` — paste that URL, or just the ST-… part."
        )
    return match.group(1)


def _ticket_error(exc: Exception) -> str:
    """A one-line cause, not a nested connection-pool dump.

    urllib3 wraps failures several layers deep and stringifies to a paragraph that
    buries the actual reason; the raw text went straight into a user-facing error and
    made a wrong service URL look like a network outage.
    """
    text = " ".join(str(exc).split())
    if "NameResolutionError" in text or "Failed to resolve" in text:
        return "could not reach the host Garmin redirected the exchange to"
    return text[:200] + ("…" if len(text) > 200 else "")


def login_with_ticket(ticket: str, token_dir: Path) -> str:
    """Exchange a CAS service ticket for the token cache. Returns display name.

    Tickets are single-use and expire in minutes, so a failure here usually means the
    ticket was already spent or went stale, not that anything is misconfigured.

    Two things here are deliberate and were both learned the hard way.

    **The DI exchange specifically, not the library's `_establish_session` wrapper.**
    That wrapper tries the DI token exchange and then falls back to a JWT_WEB cookie
    session. A cookie session works for the current process and then evaporates: the
    token cache serialises `di_token` / `di_refresh_token` / `di_client_id` and nothing
    else, so falling back would write a file of nulls, report a successful sign-in, and
    fail on every run afterwards. A sign-in that cannot be resumed is not a sign-in.
    (In garminconnect 0.3.16 that fallback also crashes outright on a `requests`
    session — `RequestsCookieJar` has no `.jar` — so it buys nothing anyway.)

    **`service_url` is not optional.** A CAS ticket is bound to the service it was
    issued for and the exchange sends that value back for Garmin to check. Omitting it
    defaults to the library's mobile service URL, which the SIGNIN_URL ticket is not
    valid for — and whose host (`mobile.integration.garmin.com`) does not resolve at
    all, so the mismatch arrived as a DNS error and read like a broken network.

    Both reach for library internals: consuming a ticket handed over by a human is not
    something its public surface offers, and the alternative is reimplementing the DI
    exchange here and owning it forever. If an upgrade moves them, this raises a clear
    error and the password login is unaffected.
    """
    ticket = extract_ticket(ticket)
    client = _new_client()
    exchange = getattr(client.client, "_exchange_service_ticket", None)
    if exchange is None:  # pragma: no cover - only reachable on a library change
        raise ConnectError(
            "This garminconnect release no longer exposes ticket-based sign-in. "
            "Use the email-and-password login instead."
        )
    try:
        exchange(ticket, service_url=SIGNIN_SERVICE_URL)
    except Exception as exc:
        raise ConnectError(
            f"Garmin rejected the ticket ({_ticket_error(exc)}). Tickets are single-use "
            "and short-lived — sign in again to get a fresh one and exchange it straight "
            "away."
        ) from exc

    if not getattr(client.client, "di_token", None):
        # Belt and braces: the exchange returned without raising but left nothing to
        # save. Better to say so now than to write an empty cache and call it connected.
        raise ConnectError(
            "The ticket was accepted but Garmin returned no usable token. "
            "Sign in again for a fresh ticket."
        )

    _prepare_token_dir(token_dir)
    _save(client, token_dir)
    _set_client(client)
    return _display_name(client)


def logout(token_dir: Path) -> int:
    """Delete the token cache. The only way to disconnect the Garmin account."""
    _set_client(None)
    path = token_file(token_dir)
    if not path.is_file():
        return 0
    path.unlink()
    return 1


def resume(token_dir: Path) -> str:
    """Restore a saved session. Returns the Connect display name (the API's user key)."""
    if not token_dir_is_populated(token_dir):
        raise NotAuthenticated(
            f"No Garmin token cache in {token_dir}. Run `odeda login` first."
        )
    client = _new_client()
    try:
        client.login(tokenstore=str(token_dir))
    except Exception as exc:
        raise NotAuthenticated(
            f"The saved Garmin session in {token_dir} is no longer good ({exc}). "
            "Run `odeda login` again."
        ) from exc
    # A refreshed token is worth keeping: the library rotates it on resume.
    try:
        _save(client, token_dir)
    except Exception:  # pragma: no cover - a stale cache still works for this run
        log.debug("could not rewrite the token cache; continuing with the live session")
    _set_client(client)
    name = _display_name(client)
    if not name:
        raise NotAuthenticated("Resumed a session but Garmin returned no display name.")
    return name


# ---------------------------------------------------------------------------
# Transport
# ---------------------------------------------------------------------------


def split_query(path: str) -> tuple[str, dict[str, str] | None]:
    """Separate `a/b?x=1` into `("a/b", {"x": "1"})`.

    The library refuses a `?` inside an API path — query strings belong in `params`, and
    it validates that to keep a crafted path from escaping the API host. `ENDPOINTS`
    stores whole URLs because that is how they read in Garmin's own responses, so the
    split happens here, once, instead of in every endpoint definition.
    """
    base, sep, query = path.partition("?")
    if not sep:
        return base, None
    return base, dict(parse_qsl(query, keep_blank_values=True))


def _status_of(exc: Exception) -> int | None:
    """The HTTP status behind a library exception, whichever way it carries one."""
    status = getattr(getattr(exc, "response", None), "status_code", None)
    if status is not None:
        return int(status)
    gc = _garminconnect()
    if isinstance(exc, gc.GarminConnectNotFoundError):
        return 404
    if isinstance(exc, gc.GarminConnectTooManyRequestsError):
        return 429
    if isinstance(exc, gc.GarminConnectAuthenticationError):
        return 401
    return None


def fetch(path: str, retries: int = MAX_RETRIES, delay: float = REQUEST_DELAY_S) -> Any:
    """GET a Connect path and return the decoded JSON, with backoff on transport errors.

    A 404 (no data for that day) is not an error: it returns None. That happens all the
    time — the watch was off the wrist, or the metric did not exist on that firmware.
    """
    client = _client()
    base, params = split_query(path)
    last_exc: Exception | None = None
    for attempt in range(retries):
        try:
            time.sleep(delay)
            return client.connectapi(base, params=params)
        except Exception as exc:
            status = _status_of(exc)
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

    # The display name goes into the URL path, so it is encoded rather than trusted:
    # Garmin allows characters in it that would otherwise change which endpoint is hit.
    user_key = quote(user, safe="")

    for d in daterange(start, end):
        day = d.isoformat()
        path = endpoint.path.format(user=user_key, date=day)
        payload = fetcher(path)
        if on_day:
            on_day(day)
        # Reached, whatever came back. A day Garmin answered with nothing is still a day
        # walked: tying the watermark to days *with data* left an endpoint the watch
        # never fills (training readiness, here) at no watermark at all, and every sync
        # re-walked 400 days of it — four minutes each time. Late data is the overlap's
        # job (`default_start`), not the watermark's.
        last_ok = day
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


def default_start(
    store,
    endpoint: str,
    lookback_days: int,
    end: date,
    overlap_days: int = 3,
    ignore_watermark: bool = False,
) -> date:
    """Resume from the watermark minus a few days of overlap.

    The overlap is deliberate: Garmin backfills sleep and HRV for a day or two after
    the fact, and re-ingesting an unchanged payload is free (content-hash dedupe).

    `ignore_watermark` goes back `lookback_days` regardless. Needed because the
    watermark records *how far a sync reached*, not *how much history exists*: one
    short sync sets it to today, and from then on every later run — including a full
    backfill — resumes from today and silently declines to fetch the years behind it.
    There was no way out of that state short of editing the database.
    """
    mark = None if ignore_watermark else store.get_watermark(endpoint)
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
    ignore_watermark: bool = False,
) -> list[dict[str, Any]]:
    """Incremental sync. Safe to re-run: every write is an upsert keyed on day or id.

    `ignore_watermark` re-walks the whole `days` window instead of resuming — the way
    back from a watermark that has run ahead of the data actually collected.
    """
    end = end or date.today()
    user = user or resume(settings.token_dir)
    names = list(endpoints) if endpoints else list(ENDPOINTS)
    results: list[dict[str, Any]] = []

    if include_activities:
        start = default_start(store, "activities", days, end, ignore_watermark=ignore_watermark)
        if on_progress:
            on_progress("activities", f"{start} .. {end}")
        with store.tx():
            results.append(sync_activities(store, start, end, fetcher=fetcher))

    for name in names:
        ep = ENDPOINTS[name]
        start = default_start(store, name, days, end, ignore_watermark=ignore_watermark)
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

        # Activities too, from whatever archived them (connect, seed, an export ZIP).
        # This is the same write path a sync takes — it rewrites every row in
        # `activities` from the raw payload — which makes it the honest way to prove
        # that user overrides survive a re-ingest rather than merely asserting it.
        from ..analytics import load as load_mod
        import json as _json

        rows = store.query(
            "SELECT ref_key, payload FROM raw_documents WHERE endpoint = 'activities' "
            "ORDER BY id"
        )
        n = 0
        for r in rows:
            try:
                payload = _json.loads(r["payload"])
            except (TypeError, ValueError):
                continue
            row = norm.normalize_activity(payload)
            if not row.get("activity_id") or not row.get("day"):
                continue
            zones = {
                int(z["zone"]): float(z["seconds"])
                for z in store.query(
                    "SELECT zone, seconds FROM activity_hr_zones WHERE activity_id = ?",
                    (row["activity_id"],),
                )
            }
            row["trimp"] = load_mod.activity_trimp(row, zones, store.settings)
            store.upsert("activities", ["activity_id"], row)
            n += 1
        counts["activities"] = n
    return counts
