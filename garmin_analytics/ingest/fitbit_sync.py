"""Fetching weigh-ins from Fitbit and turning them into `body_composition` rows.

`fitbit.py` is the session; this is what it is for.

The shape of the problem is the rate limit. Fitbit allows **150 requests per hour per
user** and the owner has years of history, so a day-by-day walk is not a slow version of
this job — it is an impossible one: three years is 1,100 days, or eight hours of
sleeping on a 429. The weight *log* endpoint takes a date range of up to 31 days and
returns every reading in it, complete with body fat and BMI, so the same three years is
**36 requests** and the whole backfill fits inside a quarter of one hour's budget.

Everything else follows the Garmin ingest: raw-first archival before anything is parsed,
idempotent upserts keyed by day, a watermark per endpoint, and a run that can be killed
and resumed without losing its place.
"""

from __future__ import annotations

import logging
import time
from datetime import date, timedelta
from typing import Any, Callable

from . import fitbit as fitbit_mod
from . import normalize as norm

log = logging.getLogger("garmin_analytics.fitbit_sync")

#: The watermark and `raw_documents.endpoint` name. One string, used in both places, so
#: the Settings sync panel and the archive agree about what this data is called.
ENDPOINT = "fitbit_body"

SOURCE = "fitbit"

#: The documented maximum for the weight-log range form. Asking for more is a 400.
WINDOW_DAYS = 31

#: Seconds between calls. The limit is 150/hour and a backfill of even ten years is
#: 120 calls, so there is no need to go fast and every reason not to look like a script.
PAUSE_S = 1.0

#: Stop this far short of the hourly budget. The app makes other calls — the profile on
#: the Settings page, the next incremental sync — and a backfill that drains the last
#: request leaves the account looking broken for an hour.
RESERVE_CALLS = 10

#: How far back a *re-sync* re-reads. Fitbit lets a reading be edited or back-dated
#: after the fact, so the days either side of the watermark are re-fetched rather than
#: trusted. Two windows is cheap; a wrong weight that never corrects itself is not.
RESYNC_OVERLAP_DAYS = 45

#: Fitbit launched in 2009 and the Aria scale in 2012. Walking back past this is
#: guaranteed-empty request volume, and it is only ever the fallback: the account's own
#: `memberSince` is used when the profile can be read.
EARLIEST_PLAUSIBLE = date(2009, 1, 1)


def weight_log_path(start: date, end: date) -> str:
    """The range form: every reading between two dates, inclusive, in one call."""
    return f"/1/user/-/body/log/weight/date/{start.isoformat()}/{end.isoformat()}.json"


def windows(start: date, end: date, size_days: int = WINDOW_DAYS) -> list[tuple[date, date]]:
    """Split a span into inclusive chunks no longer than the endpoint accepts.

    Inclusive at both ends, which is what makes the arithmetic `size_days - 1`: a
    31-day window running 2026-01-01 to 2026-02-01 is 32 days and Fitbit refuses it.
    """
    if end < start:
        return []
    out: list[tuple[date, date]] = []
    cursor = start
    while cursor <= end:
        stop = min(cursor + timedelta(days=size_days - 1), end)
        out.append((cursor, stop))
        cursor = stop + timedelta(days=1)
    return out


def account_start(client: fitbit_mod.FitbitClient) -> date:
    """The day the account was opened, so the backfill has a floor that is not a guess.

    A profile that cannot be read is not worth failing a backfill over — the fallback
    costs a handful of empty windows, and `EARLIEST_PLAUSIBLE` bounds even that.
    """
    try:
        member_since = str(client.profile().get("memberSince") or "")[:10]
        if member_since:
            return max(date.fromisoformat(member_since), EARLIEST_PLAUSIBLE)
    except (fitbit_mod.FitbitError, ValueError) as exc:
        log.debug("could not read the Fitbit profile (%s); falling back to %s",
                  exc, EARLIEST_PLAUSIBLE)
    return EARLIEST_PLAUSIBLE


def resume_from(store, fallback: date) -> date:
    """Where the next run starts: just before the watermark, or the account's start.

    Re-reading `RESYNC_OVERLAP_DAYS` behind the watermark is the point. The upsert is
    keyed by day so re-reading costs nothing, and a reading the owner corrected on the
    Fitbit app last week would otherwise never be picked up.
    """
    mark = store.get_watermark(ENDPOINT)
    if not mark:
        return fallback
    try:
        return date.fromisoformat(str(mark)[:10]) - timedelta(days=RESYNC_OVERLAP_DAYS)
    except ValueError:
        return fallback


def sync_body(
    store,
    client: fitbit_mod.FitbitClient,
    start: date | None = None,
    end: date | None = None,
    echo: Callable[[str], None] | None = None,
    should_stop: Callable[[], bool] | None = None,
    sleep: Callable[[float], None] = time.sleep,
) -> dict[str, Any]:
    """Walk the account's weigh-ins into `body_composition`, oldest window first.

    Oldest first, and the watermark advances only after a window has actually been
    written. That is what makes a killed run resumable: whatever the watermark says has
    genuinely landed, so the next run re-reads a little and loses nothing.

    Stops — rather than fails — on the rate limit and on the caller's `should_stop`,
    reporting where it got to. A backfill that throws away 30 completed windows because
    the 31st hit a 429 would be worse than useless.
    """
    end = end or date.today()
    begin = start or resume_from(store, account_start(client))
    spans = windows(begin, end)

    result: dict[str, Any] = {
        "endpoint": ENDPOINT,
        "from": begin.isoformat(),
        "to": end.isoformat(),
        "windows": len(spans),
        "windows_done": 0,
        "days_written": 0,
        "state": "done",
        "retry_after_s": None,
    }
    if not spans:
        return result

    for index, (window_start, window_end) in enumerate(spans):
        if should_stop and should_stop():
            result["state"] = "stopped"
            break
        if client.remaining is not None and client.remaining <= RESERVE_CALLS:
            # Seen coming rather than discovered by a 429: the budget is shared with
            # the rest of the app and draining it makes everything else look broken.
            result["state"] = "rate_limited"
            result["retry_after_s"] = 3600
            break

        try:
            payload = client.get(weight_log_path(window_start, window_end))
        except fitbit_mod.RateLimited as limited:
            result["state"] = "rate_limited"
            result["retry_after_s"] = limited.retry_after_s
            break

        written = write_weight_payload(store, payload, window_start, window_end)
        result["days_written"] += written
        result["windows_done"] += 1
        store.set_watermark(
            ENDPOINT,
            window_end.isoformat(),
            "ok",
            f"{result['days_written']} weigh-ins through {window_end.isoformat()}",
        )
        if echo:
            echo(
                f"{window_start} → {window_end}: {written} weigh-in(s)"
                f"  [{index + 1}/{len(spans)}]"
            )
        if index + 1 < len(spans):
            sleep(PAUSE_S)

    if result["state"] != "done":
        store.set_watermark(
            ENDPOINT,
            store.get_watermark(ENDPOINT),
            result["state"],
            f"stopped after {result['windows_done']} of {result['windows']} windows",
        )
    return result


def write_weight_payload(store, payload: Any, window_start: date, window_end: date) -> int:
    """Archive the response verbatim, then normalise it. In that order, always.

    The ref key is the window rather than the day: it is what was asked for, so
    re-running the same window dedupes on content hash and a re-parse never needs a
    re-fetch — which is the whole point of the raw archive.
    """
    ref_key = f"{window_start.isoformat()}:{window_end.isoformat()}"
    with store.tx():
        raw_id = store.store_raw(SOURCE, ENDPOINT, ref_key, payload)
        rows = norm.normalize_fitbit_weight(payload)
        for row in rows:
            store.upsert("body_composition", ["day"], {**row, "raw_id": raw_id})
    return len(rows)


def status(store, token_dir) -> dict[str, Any]:
    """What Settings shows: connected or not, and how far the data goes.

    Deliberately makes no network call. A page that has to talk to Fitbit to render
    spends a request out of 150 every time it is opened.
    """
    watermark = store.get_watermark(ENDPOINT)
    row = store.query(
        "SELECT COUNT(*) AS n, MIN(day) AS first_day, MAX(day) AS last_day "
        "FROM body_composition"
    )[0]
    return {
        "connected": fitbit_mod.is_connected(token_dir),
        "credentials_configured": fitbit_mod.Credentials.configured(),
        "user_id": fitbit_mod.connected_account(token_dir),
        "last_synced_day": watermark,
        "weigh_ins": int(row["n"] or 0),
        "first_day": row["first_day"],
        "last_day": row["last_day"],
    }
