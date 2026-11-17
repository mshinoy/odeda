"""Fetching weigh-ins from Google Health and turning them into `body_composition` rows.

`fitbit.py` is the session; this is what it is for.

The shape of the problem changed with the API. The Fitbit Web API allowed **150 requests
an hour**, which is what forced the old design: a 31-day range form, 36 carefully paced
calls for three years, and a reserve held back so opening Settings did not drain the
budget. Google Health allows **300 requests a minute per user** and pages with a cursor
instead of a date range, so a full history is a handful of calls and the pacing
machinery is gone.

What replaced it is a different shape: **weight and body fat are separate data types**.
The old weigh-in record carried both; now they are two paginated queries merged by day.
A day with a weight and no fat reading keeps a null — a manual entry has no body fat and
must not invent a zero.

Everything else follows the Garmin ingest: raw-first archival before anything is parsed,
idempotent upserts keyed by day, a watermark per endpoint, and a run that can be killed
and resumed without losing its place.
"""

from __future__ import annotations

import logging
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable

from . import fitbit as fitbit_mod
from . import normalize as norm

log = logging.getLogger("odeda.fitbit_sync")

#: The watermark and `raw_documents.endpoint` name. One string, used in both places, so
#: the Settings sync panel and the archive agree about what this data is called.
ENDPOINT = "fitbit_body"

SOURCE = "fitbit"

#: How far back a *re-sync* re-reads. A reading can be edited or back-dated after the
#: fact, so the days either side of the watermark are re-fetched rather than trusted.
#: Cheap; a wrong weight that never corrects itself is not.
RESYNC_OVERLAP_DAYS = 45

#: Fitbit launched in 2009 and the Aria scale in 2012. Walking back past this is
#: guaranteed-empty query range, and the filter is a single request either way.
EARLIEST_PLAUSIBLE = date(2009, 1, 1)

#: Data points per page. The documented maximum is 10000 and the default is 1440, so
#: asking for the maximum keeps a decade of daily weigh-ins (~3,650 points) to a single
#: request; the cursor handles anything larger. Values above the maximum are truncated
#: rather than rejected, so this is safe even if the ceiling moves.
PAGE_SIZE = 10000


def since_filter(data_type_field: str, start: date) -> str:
    """A `filter` expression restricting a data type to samples on or after a date.

    The field prefix is the data type's *filter parameter* — underscores, not the
    hyphens used in the URL path (`body_fat` in a filter, `body-fat` in a path). Getting
    those the wrong way round is an INVALID_ARGUMENT that reads like a server fault.
    """
    stamp = f"{start.isoformat()}T00:00:00Z"
    return f'{data_type_field}.sample_time.physical_time >= "{stamp}"'


def resume_from(store, fallback: date) -> date:
    """Where the next run starts: behind the watermark, or the account's floor.

    Re-reading `RESYNC_OVERLAP_DAYS` behind the watermark is the point. The upsert is
    keyed by day so re-reading costs nothing, and a reading corrected in the Google
    Health app last week would otherwise never be picked up.
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
) -> dict[str, Any]:
    """Pull weigh-ins and body-fat readings into `body_composition`.

    Two fetches, each following its own cursor to the end, merged by day and written in
    one transaction. The watermark advances only after the write lands, so a killed run
    re-reads a little and loses nothing.

    Stops — rather than fails — on the rate limit and on the caller's `should_stop`,
    reporting where it got to.
    """
    end = end or date.today()
    begin = start or resume_from(store, EARLIEST_PLAUSIBLE)

    result: dict[str, Any] = {
        "endpoint": ENDPOINT,
        "start_day": begin.isoformat(),
        "end_day": end.isoformat(),
        "days_written": 0,
        "weight_points": 0,
        "body_fat_points": 0,
        "state": "done",
        "retry_after_s": None,
    }

    if should_stop and should_stop():
        result["state"] = "stopped"
        return result

    try:
        weight_points = client.data_points(
            fitbit_mod.WEIGHT_DATA_TYPE,
            since_filter("weight", begin),
            PAGE_SIZE,
        )
        if echo:
            echo(f"weight: {len(weight_points)} reading(s) since {begin}")

        if should_stop and should_stop():
            result["state"] = "stopped"
            return result

        # Body fat is its own data type and its own permission-shaped risk: the scope is
        # shared with weight, so if weight came back this will too. A failure here is
        # still not allowed to discard the weights already in hand.
        fat_points = client.data_points(
            fitbit_mod.BODY_FAT_DATA_TYPE,
            since_filter("body_fat", begin),
            PAGE_SIZE,
        )
        if echo:
            echo(f"body fat: {len(fat_points)} reading(s) since {begin}")
    except fitbit_mod.RateLimited as limited:
        result["state"] = "rate_limited"
        result["retry_after_s"] = limited.retry_after_s
        store.set_watermark(
            ENDPOINT,
            store.get_watermark(ENDPOINT),
            "rate_limited",
            f"rate limited; retry in {limited.retry_after_s}s",
        )
        return result

    result["weight_points"] = len(weight_points)
    result["body_fat_points"] = len(fat_points)

    written, last_day = write_points(store, weight_points, fat_points, begin, end)
    result["days_written"] = written

    # The watermark is the last day actually written, not the day the run happened. A
    # run that found nothing must not advance it past data that might arrive later.
    mark = last_day or store.get_watermark(ENDPOINT) or begin.isoformat()
    store.set_watermark(ENDPOINT, mark, "ok", f"{written} weigh-in(s) through {mark}")
    result["last_day"] = mark
    if echo:
        echo(f"wrote {written} day(s) through {mark}")
    return result


def write_points(
    store,
    weight_points: list[Any],
    fat_points: list[Any],
    window_start: date,
    window_end: date,
) -> tuple[int, str | None]:
    """Archive both responses verbatim, then normalise and merge. In that order, always.

    The raw archive is keyed by data type and window so a re-parse never needs a
    re-fetch — which is the whole point of keeping it.
    """
    ref_key = f"{window_start.isoformat()}:{window_end.isoformat()}"
    with store.tx():
        weight_raw = store.store_raw(
            SOURCE, f"{ENDPOINT}:weight", ref_key, {"dataPoints": weight_points}
        )
        store.store_raw(
            SOURCE, f"{ENDPOINT}:body_fat", ref_key, {"dataPoints": fat_points}
        )
        merged = norm.merge_daily(
            [
                *norm.normalize_health_weight({"dataPoints": weight_points}),
                *norm.normalize_health_body_fat({"dataPoints": fat_points}),
            ]
        )
        # A body-fat reading on a day with no weight has nothing to hang on: the table
        # is keyed by day and `weight_kg` is the column everything downstream reads.
        rows = [row for row in merged.values() if row.get("weight_kg") is not None]
        for row in rows:
            store.upsert("body_composition", ["day"], {**row, "raw_id": weight_raw})
    last_day = max((str(r["day"]) for r in rows), default=None)
    return len(rows), last_day


def status(store, token_dir) -> dict[str, Any]:
    """What Settings shows: connected or not, and how far the data goes.

    Deliberately makes no network call — a page that has to talk to Google Health to
    render is a page that can fail to render.
    """
    watermark = store.get_watermark(ENDPOINT)
    try:
        tokens = fitbit_mod.load_tokens(Path(token_dir))
    except fitbit_mod.FitbitError:
        tokens = None
    expires = tokens.signin_expires_at() if tokens else None
    row = store.query(
        "SELECT COUNT(*) AS n, MIN(day) AS first_day, MAX(day) AS last_day "
        "FROM body_composition"
    )[0]
    return {
        "connected": fitbit_mod.is_connected(token_dir),
        "credentials_configured": fitbit_mod.Credentials.configured(),
        "user_id": fitbit_mod.connected_account(token_dir),
        "signin_expires_at": (
            datetime.fromtimestamp(expires, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            if expires is not None
            else None
        ),
        "last_synced_day": watermark,
        "weigh_ins": int(row["n"] or 0),
        "first_day": row["first_day"],
        "last_day": row["last_day"],
    }
