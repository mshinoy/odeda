"""The training plan: subscribing to the calendar the owner keeps by hand.

The plan is not in this app and should not be. It is a Google Calendar the owner edits
on a phone, and it changes — sessions move, a club run gets deleted, a week's target is
rewritten after a bad Friday. So this reads it rather than owning it, on the same six-
hourly schedule as everything else.

**The feed URL is a credential.** A Google private iCal address grants read access to
the whole calendar to anyone holding it, with no further authentication. It is stored in
`plan_sources`, masked everywhere it leaves the API, and never written to a log — which
includes the ones `urllib` writes for you, so errors are re-raised with the URL stripped.

**Nothing is ever deleted.** A session that leaves the feed is stamped `withdrawn_at`.
Google takes a series' past instances with it when the series is deleted — that is what
happened to a year of Saturday club runs on 2026-09-19 — so a table that mirrored the
feed would quietly rewrite weeks the owner had already finished.

Stdlib only (D7, D10); the HTTP call goes through an injectable transport so the whole
path is testable without a network, the way the Garmin and Google clients already are.
"""

from __future__ import annotations

import logging
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from typing import Any, Mapping, Protocol
from zoneinfo import ZoneInfo

from .. import config
from . import ics

log = logging.getLogger("odeda.plan_ics")

#: How far past race day to keep expanding. A taper week plus the race itself, so the
#: plan page has somewhere to end rather than stopping mid-week.
#: How far ahead recurrence is expanded. Long enough for any block the owner is
#: planning, short enough that a weekly rule with no end does not run for ever.
HORIZON_DAYS = 400

#: Google answers an iCal request with `text/calendar`. An HTML body means the secret
#: address was reset or revoked and the request was redirected to a sign-in page — a
#: failure that otherwise arrives as "200 OK" and parses as zero sessions, which reads
#: in the UI as "you have no plan" rather than "the link is dead".
CALENDAR_CONTENT_TYPES = ("text/calendar", "application/octet-stream", "text/plain")

USER_AGENT = "odeda/1.0 (+https://github.com/ ; personal use)"


class PlanFeedError(RuntimeError):
    """The feed could not be fetched or is not a calendar. Message is owner-facing."""


@dataclass(frozen=True)
class FeedResponse:
    status: int
    headers: Mapping[str, str]
    body: str

    def header(self, name: str) -> str | None:
        for key, value in self.headers.items():
            if key.lower() == name.lower():
                return value
        return None


class Transport(Protocol):
    def get(self, url: str, headers: Mapping[str, str]) -> FeedResponse: ...


class UrllibTransport:
    """Stdlib fetch. Timeouts are short: this runs inside the sync scheduler, and a feed
    that hangs would hold the job that Garmin and Google Health share with it."""

    def __init__(self, timeout: float = 20.0) -> None:
        self.timeout = timeout

    def get(self, url: str, headers: Mapping[str, str]) -> FeedResponse:
        request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, **headers})
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                charset = response.headers.get_content_charset() or "utf-8"
                return FeedResponse(
                    status=response.status,
                    headers=dict(response.headers.items()),
                    body=response.read().decode(charset, errors="replace"),
                )
        except urllib.error.HTTPError as exc:
            if exc.code == 304:
                return FeedResponse(304, dict(exc.headers.items()), "")
            raise PlanFeedError(_http_reason(exc.code)) from None
        except urllib.error.URLError as exc:
            # `exc` stringifies to include the URL on some failures. The URL is a secret.
            raise PlanFeedError(f"could not reach the calendar ({exc.reason})") from None


def _http_reason(code: int) -> str:
    if code in (401, 403):
        return (
            "the calendar refused the request (HTTP %d) — a private iCal address stops "
            "working when it is reset in Google Calendar; copy the new one" % code
        )
    if code == 404:
        return (
            "the calendar was not found (HTTP 404) — the private address was reset or "
            "the calendar was deleted"
        )
    return f"the calendar answered HTTP {code}"


def mask_url(url: str) -> str:
    """`https://calendar.google.com/calendar/ical/…/private-abc123/basic.ics` →
    `https://calendar.google.com/…/basic.ics`. Enough to recognise, not enough to use."""
    try:
        parsed = urllib.parse.urlsplit(url)
    except ValueError:
        return "…"
    tail = parsed.path.rsplit("/", 1)[-1] or ""
    host = parsed.netloc or "…"
    return f"{parsed.scheme}://{host}/…/{tail}" if tail else f"{parsed.scheme}://{host}/…"


# ---------------------------------------------------------------------------
# Sources
# ---------------------------------------------------------------------------


def set_source(store, url: str, label: str | None = None, kind: str = "ics") -> int:
    """Replace the subscribed calendar. Returns its id.

    One source at a time, deliberately: the question this app answers is "am I following
    *the* plan", and two calendars would make "prescribed" ambiguous without any way for
    the owner to say which one wins.
    """
    url = url.strip()
    if not url.lower().startswith(("http://", "https://")):
        raise PlanFeedError("that does not look like a calendar address")
    # Replacing a rotated address is not starting a new plan, so the start day survives
    # it. Deleting the old row would otherwise silently widen the plan back to the whole
    # calendar, which is the bug T49 exists to remove, arriving by a side door.
    previous = get_source(store)
    carried = None if previous is None else previous["start_day"]
    with store.tx():
        store.conn.execute("DELETE FROM plan_sources WHERE url <> ?", (url,))
        store.upsert(
            "plan_sources",
            ["kind", "url"],
            {"kind": kind, "url": url, "label": label, "enabled": 1, "start_day": carried},
        )
    return int(store.scalar("SELECT id FROM plan_sources WHERE url = ?", (url,)))


def set_start_day(store, day: str | None) -> None:
    """Draw the line the plan begins at, or pass `None` to use the whole calendar.

    Validated here rather than at the edge because it is a fact about the plan, not
    about HTTP: a start day past everything the calendar holds silences every week
    there is.

    Measured against the last prescribed session, not against a race date. The first
    version refused anything after `config.RACE_DATE`, so the reset control stopped
    working on the day it was most wanted — starting the next block after a race.
    """
    if day is not None:
        day = day.strip()
        try:
            parsed = date.fromisoformat(day)
        except ValueError as exc:
            raise PlanFeedError("a start day must be a date, as 2026-09-01") from exc
        # Compared on the parsed value, not the raw text: `fromisoformat` accepts
        # forms a string comparison would get wrong.
        day = parsed.isoformat()
        last = store.scalar(
            "SELECT MAX(day) FROM plan_sessions WHERE withdrawn_at IS NULL"
        )
        if last is not None and day > str(last):
            raise PlanFeedError(
                f"that is after the last session the calendar holds ({last}), "
                "which would leave nothing prescribed"
            )
    if get_source(store) is None:
        raise PlanFeedError("no calendar is subscribed")
    with store.tx():
        store.conn.execute("UPDATE plan_sources SET start_day = ?", (day,))


def get_source(store) -> dict[str, Any] | None:
    # The live one: an enabled source first, and the newest of those. After an upload the
    # old subscription is kept but switched off, and it must not be the one reported.
    rows = store.query("SELECT * FROM plan_sources ORDER BY enabled DESC, id DESC LIMIT 1")
    return rows[0] if rows else None


def adopt_env_url(store, settings=None) -> int | None:
    """Subscribe from `GA_PLAN_ICS_URL` when nothing is subscribed yet.

    A bootstrap default, not an override: once a row exists the database wins and the
    variable is ignored. Env always winning would mean an address changed in Settings
    silently reverting at the next restart, which is a worse surprise than editing a
    file. Returns the source id when it adopted one, else None.
    """
    from ..config import load_settings

    settings = settings or load_settings()
    url = (getattr(settings, "plan_ics_url", "") or "").strip()
    if not url or get_source(store) is not None:
        return None
    try:
        return set_source(store, url, label="Training")
    except PlanFeedError:
        # A malformed variable must not stop the app starting. The owner sees it as
        # "no calendar subscribed", and Settings is where they fix it.
        log.warning("GA_PLAN_ICS_URL is not a usable calendar address; ignoring it")
        return None


def clear_source(store) -> None:
    """Forget the calendar. The sessions it prescribed stay: a past week is still a week
    the owner trained, and deleting the plan should not silently delete the record of it."""
    with store.tx():
        store.conn.execute("UPDATE plan_sessions SET withdrawn_at = COALESCE(withdrawn_at, ?)",
                           (_utcnow(),))
        store.conn.execute("DELETE FROM plan_sources")


# ---------------------------------------------------------------------------
# Sync
# ---------------------------------------------------------------------------


def _utcnow() -> str:
    from ..db.store import utcnow

    return utcnow()


def window(today: date, tz: ZoneInfo) -> tuple[datetime, datetime]:
    """How far to expand: from the feed's own past to a fixed horizon ahead.

    The start is deliberately open: `None` would read as "no bound", and the honest
    bound is "whatever the calendar holds", so the caller passes nothing and the feed
    decides. Only the end is capped, because an open-ended weekly rule has no end.

    It used to end a week past `config.RACE_DATE`. The race now comes *from* the
    sessions this expansion produces, which made that circular — on a first sync there
    are none, so there would be no race to bound the window that creates it. A horizon
    from today also moves forward on its own, where a constant froze the plan the day
    the race passed.
    """
    end_day = today + timedelta(days=HORIZON_DAYS)
    return (
        datetime.combine(date(1970, 1, 1), time.min, tzinfo=tz),
        datetime.combine(end_day, time.max, tzinfo=tz),
    )


def sync_plan(
    store,
    transport: Transport | None = None,
    today: date | None = None,
    tz_name: str = config.RACE_TIMEZONE,
) -> dict[str, Any]:
    """Fetch the calendar and bring `plan_sessions` level with it.

    Returns a summary the sync status and Settings both read. A feed that has not
    changed is a success with nothing written — `unchanged`, not a failure, and it still
    moves `last_fetch_at` so Settings can say when it last looked.
    """
    adopt_env_url(store)
    source = get_source(store)
    if source is None or not source["enabled"]:
        return {"status": "skipped", "reason": "no calendar subscribed"}
    if source["kind"] != "ics":
        return {"status": "skipped", "reason": "an uploaded plan has nothing to sync"}

    transport = transport or UrllibTransport()
    tz = ZoneInfo(tz_name)
    today = today or date.today()

    headers: dict[str, str] = {}
    if source["etag"]:
        headers["If-None-Match"] = source["etag"]
    if source["last_modified"]:
        headers["If-Modified-Since"] = source["last_modified"]

    try:
        response = transport.get(source["url"], headers)
    except PlanFeedError as exc:
        _record(store, source["id"], error=str(exc))
        raise

    if response.status == 304:
        _record(store, source["id"], error=None)
        return {"status": "unchanged", "sessions": 0, "withdrawn": 0, "unsupported": 0}

    if response.status != 200:
        message = _http_reason(response.status)
        _record(store, source["id"], error=message)
        raise PlanFeedError(message)

    content_type = (response.header("Content-Type") or "").split(";")[0].strip().lower()
    if content_type and content_type not in CALENDAR_CONTENT_TYPES:
        message = (
            f"the calendar answered with {content_type}, not a calendar — a private "
            "iCal address that has been reset redirects to a sign-in page"
        )
        _record(store, source["id"], error=message)
        raise PlanFeedError(message)

    try:
        events = ics.parse_events(response.body, tz)
    except ics.IcsError as exc:
        message = f"the feed is not a calendar ({exc})"
        _record(store, source["id"], error=message)
        raise PlanFeedError(message) from None

    start, end = window(today, tz)
    instances = ics.expand(events, end, tz, window_start=start)

    raw_id = store.store_raw("plan_ics", "plan", f"source-{source['id']}", {"ics": response.body})
    result = _write(store, source["id"], instances, raw_id)

    _record(
        store,
        source["id"],
        error=None,
        etag=response.header("ETag"),
        last_modified=response.header("Last-Modified"),
    )
    parsed = apply_parse(store)
    store.set_watermark("plan", last_day=max((i.day for i in instances), default=None))
    return {"status": "ok", **result, "parsed_ok": parsed.get("ok", 0),
            "parsed_unparsed": parsed.get("unparsed", 0)}


def _write(store, source_id: int, instances, raw_id: int) -> dict[str, int]:
    """Upsert the instances, then withdraw whatever is no longer among them.

    Only the structural columns are written. `sport`, `kind` and the planned distances
    belong to the prose parser (T36) and are left alone here, so a re-sync never
    discards a reading of the text — or a correction the owner made to one.
    """
    now = _utcnow()
    seen: set[tuple[str, str]] = set()
    unsupported = 0

    with store.tx():
        for inst in instances:
            seen.add((inst.uid, inst.recurrence_id))
            if inst.unsupported_rrule:
                unsupported += 1
            store.upsert(
                "plan_sessions",
                ["source_id", "uid", "recurrence_id"],
                {
                    "source_id": source_id,
                    "uid": inst.uid,
                    "recurrence_id": inst.recurrence_id,
                    "day": inst.day,
                    "start_local": None if inst.start.all_day else inst.start.naive.isoformat(),
                    "end_local": None if inst.end is None else inst.end.naive.isoformat(),
                    "title": inst.summary,
                    "description": inst.description,
                    # Structurally fine, prose not yet read. T36's pass moves this to
                    # `ok` or `unparsed`; re-setting it on every sync is what makes an
                    # edited description get re-read rather than keeping a stale target.
                    "parse_status": "unsupported_rrule" if inst.unsupported_rrule else "pending",
                    "recurring": 1 if inst.recurring else 0,
                    "withdrawn_at": None,
                    "raw_id": raw_id,
                },
            )

        existing = store.query(
            "SELECT id, uid, recurrence_id FROM plan_sessions "
            "WHERE source_id = ? AND withdrawn_at IS NULL",
            (source_id,),
        )
        gone = [r["id"] for r in existing if (r["uid"], r["recurrence_id"]) not in seen]
        for session_id in gone:
            store.conn.execute(
                "UPDATE plan_sessions SET withdrawn_at = ? WHERE id = ?", (now, session_id)
            )

    return {"sessions": len(seen), "withdrawn": len(gone), "unsupported": unsupported}


def _record(
    store,
    source_id: int,
    error: str | None,
    etag: str | None = None,
    last_modified: str | None = None,
) -> None:
    """Stamp the attempt. `last_fetch_at` moves whether or not anything was written, so
    Settings can distinguish "looked, nothing changed" from "has not looked since Tuesday"."""
    sets = ["last_fetch_at = ?", "last_error = ?"]
    params: list[Any] = [_utcnow(), error]
    if etag is not None:
        sets.append("etag = ?")
        params.append(etag)
    if last_modified is not None:
        sets.append("last_modified = ?")
        params.append(last_modified)
    params.append(source_id)
    with store.tx():
        store.conn.execute(f"UPDATE plan_sources SET {', '.join(sets)} WHERE id = ?", params)


def sessions(store, start_day: str | None = None, end_day: str | None = None) -> list[dict[str, Any]]:
    """Live sessions in a date range, oldest first. Withdrawn ones are excluded here;
    the adherence maths asks for them explicitly when it judges a finished week."""
    sql = "SELECT * FROM plan_sessions WHERE withdrawn_at IS NULL"
    params: list[Any] = []
    if start_day:
        sql += " AND day >= ?"
        params.append(start_day)
    if end_day:
        sql += " AND day <= ?"
        params.append(end_day)
    return store.query(sql + " ORDER BY day, start_local", params)


# ---------------------------------------------------------------------------
# Reading the prose into the rows
# ---------------------------------------------------------------------------


def apply_parse(store, only_pending: bool = True) -> dict[str, int]:
    """Fill `sport`, `kind` and the planned distances from each session's own text.

    Separate from the fetch because they fail differently and are re-run for different
    reasons: the fetch is network and credentials, this is only reading. Re-running it
    costs nothing and is how an edited description takes effect, which is why a sync
    resets `parse_status` to `pending` rather than leaving a stale reading in place.

    The week notes are indexed across *every* live session first, because the note that
    governs a Friday is written on the preceding Monday's event — a row cannot be parsed
    by looking only at itself.
    """
    from ..plan import parse as P

    live = store.query(
        "SELECT id, day, title, description FROM plan_sessions WHERE withdrawn_at IS NULL"
    )
    notes = P.week_notes_by_week(live)

    rows = [r for r in live if not only_pending] or live
    if only_pending:
        pending = {
            r["id"]
            for r in store.query(
                "SELECT id FROM plan_sessions WHERE parse_status = 'pending' "
                "AND withdrawn_at IS NULL"
            )
        }
        rows = [r for r in live if r["id"] in pending]

    counts = {"ok": 0, "unparsed": 0}
    with store.tx():
        for row in rows:
            day = date.fromisoformat(str(row["day"]))
            year, week, _ = day.isocalendar()
            pres, status = P.resolve(
                str(row["title"] or ""),
                str(row["description"] or ""),
                day.weekday(),
                notes.get(f"{year}-W{week:02d}", {}),
            )
            counts[status] = counts.get(status, 0) + 1
            store.conn.execute(
                "UPDATE plan_sessions SET sport = ?, kind = ?, planned_min_m = ?, "
                "planned_max_m = ?, planned_duration_s = ?, optional = ?, "
                "parse_source = ?, parse_status = ? WHERE id = ?",
                (
                    pres.sport, pres.kind, pres.min_m, pres.max_m, pres.duration_s,
                    1 if pres.optional else 0, pres.source or None, status, row["id"],
                ),
            )
    return counts
