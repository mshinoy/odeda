"""Upload a plan: an `.ics` or CSV file that becomes the plan from a day the owner picks.

The calendar subscription (`plan_ics`) is the plan the owner keeps by hand. This is the
other way in: a file, such as a new block's calendar export or a plan written as a table.
D31 says how it takes over, and this module is that decision:

* **From a chosen day, not all at once.** Sessions before that day keep the plan they were
  judged against, so a finished week's adherence never moves because a new plan arrived.
* **Nothing is deleted.** The sessions it replaces are stamped `withdrawn_at`, as a sync
  does; the old source is kept and switched off.
* **The owner sees it first.** `preview` reports what would change, including the one
  thing that would surprise them (the race leaving the plan), and writes nothing.

The file's sessions are read by the same prose parser as the calendar's, so a title such
as `Easy run 5 km` means the same thing in both. A CSV therefore carries the session in its
title, as a calendar event does.

Stdlib only (D7, D10).
"""

from __future__ import annotations

import csv
import hashlib
import io
import logging
from dataclasses import dataclass
from datetime import date, datetime
from typing import Any
from zoneinfo import ZoneInfo

from .. import config
from . import ics, plan_ics

log = logging.getLogger("garmin_analytics.plan_upload")

#: A plan is a few hundred short lines. Anything near this is not a plan, and refusing it
#: here keeps a mistaken upload from becoming a memory problem.
MAX_BYTES = 2_000_000
MAX_SESSIONS = 5000

#: Header names a CSV may use, by what they mean. Case and spacing do not matter.
_DATE_COLUMNS = ("date", "day")
_TITLE_COLUMNS = ("title", "name", "session")
_NOTES_COLUMNS = ("description", "notes", "note")
_KM_COLUMNS = ("distance_km", "km", "distance")


class PlanUploadError(ValueError):
    """The file cannot be used as a plan. The message is for the owner."""


@dataclass(frozen=True)
class Row:
    """One prescribed session, whichever file it came from."""

    uid: str
    recurrence_id: str
    day: str
    start_local: str | None
    end_local: str | None
    title: str
    description: str
    recurring: bool = False
    unsupported_rrule: bool = False


# ---------------------------------------------------------------------------
# Reading the file
# ---------------------------------------------------------------------------


def detect_format(text: str) -> str:
    return "ics" if text.lstrip().upper().startswith("BEGIN:VCALENDAR") else "csv"


def read_plan(text: str, today: date, tz_name: str = config.RACE_TIMEZONE) -> tuple[str, list[Row]]:
    """The file's format and its sessions. Raises `PlanUploadError` for anything unusable."""
    if len(text.encode("utf-8", "ignore")) > MAX_BYTES:
        raise PlanUploadError("that file is too large to be a training plan")
    if not text.strip():
        raise PlanUploadError("that file is empty")
    fmt = detect_format(text)
    rows = _read_ics(text, today, tz_name) if fmt == "ics" else _read_csv(text)
    if not rows:
        raise PlanUploadError("that file holds no sessions")
    if len(rows) > MAX_SESSIONS:
        raise PlanUploadError(f"that file holds {len(rows)} sessions; a plan is under {MAX_SESSIONS}")
    return fmt, rows


def _read_ics(text: str, today: date, tz_name: str) -> list[Row]:
    tz = ZoneInfo(tz_name)
    try:
        events = ics.parse_events(text, tz)
    except ics.IcsError as exc:
        raise PlanUploadError(f"that file is not a calendar ({exc})") from None
    start, end = plan_ics.window(today, tz)
    return [
        Row(
            uid=i.uid,
            recurrence_id=i.recurrence_id,
            day=i.day,
            start_local=None if i.start.all_day else i.start.naive.isoformat(),
            end_local=None if i.end is None else i.end.naive.isoformat(),
            title=i.summary,
            description=i.description,
            recurring=i.recurring,
            unsupported_rrule=bool(i.unsupported_rrule),
        )
        for i in ics.expand(events, end, tz, window_start=start)
    ]


def _column(header: dict[str, str], names: tuple[str, ...]) -> str | None:
    return next((header[n] for n in names if n in header), None)


def _read_csv(text: str) -> list[Row]:
    reader = csv.DictReader(io.StringIO(text.lstrip("﻿")))
    if not reader.fieldnames:
        raise PlanUploadError("that file has no header row")
    header = {name.strip().lower().replace(" ", "_"): name for name in reader.fieldnames if name}
    date_col = _column(header, _DATE_COLUMNS)
    title_col = _column(header, _TITLE_COLUMNS)
    if date_col is None or title_col is None:
        raise PlanUploadError("a CSV plan needs a `date` column and a `title` column")
    notes_col = _column(header, _NOTES_COLUMNS)
    km_col = _column(header, _KM_COLUMNS)

    rows: list[Row] = []
    for number, record in enumerate(reader, start=2):
        raw_day = (record.get(date_col) or "").strip()
        title = (record.get(title_col) or "").strip()
        if not raw_day and not title:
            continue
        try:
            day = datetime.strptime(raw_day, "%Y-%m-%d").date().isoformat()
        except ValueError:
            raise PlanUploadError(
                f"row {number}: `{raw_day}` is not a date; write it as 2026-11-16"
            ) from None
        if not title:
            raise PlanUploadError(f"row {number}: the title is empty")
        title = _with_distance(title, (record.get(km_col) or "") if km_col else "", number)
        rows.append(
            Row(
                uid=f"csv:{day}:{len(rows)}",
                recurrence_id=day,
                day=day,
                start_local=None,
                end_local=None,
                title=title,
                description=((record.get(notes_col) or "") if notes_col else "").strip(),
            )
        )
    return rows


def _with_distance(title: str, km_text: str, number: int) -> str:
    """Put a distance column into the title, where the prose parser looks for it."""
    km_text = km_text.strip().replace(",", ".")
    if not km_text:
        return title
    try:
        km = float(km_text)
    except ValueError:
        raise PlanUploadError(f"row {number}: `{km_text}` is not a distance in kilometres") from None
    if not 0 < km <= 500:
        raise PlanUploadError(f"row {number}: a distance between 0 and 500 km, not {km_text}")
    return f"{title} {km:g} km"


# ---------------------------------------------------------------------------
# What taking over would do, and doing it
# ---------------------------------------------------------------------------


def _check_day(text: str) -> str:
    try:
        return date.fromisoformat((text or "").strip()).isoformat()
    except ValueError:
        raise PlanUploadError("the day it takes over from must be a date, as 2026-11-16") from None


def _race_in(rows: list[Row]) -> dict[str, str] | None:
    """The race the new plan holds, read the way the calendar's race is: by the parser."""
    from ..plan import parse as P

    found = []
    for r in rows:
        if "race" not in f"{r.title} {r.description}".lower():
            continue
        day = date.fromisoformat(r.day)
        pres, _ = P.resolve(r.title, r.description, day.weekday(), {})
        if pres.kind == "race":
            found.append(r)
    if not found:
        return None
    first = min(found, key=lambda r: r.day)
    return {"name": first.title, "date": first.day}


def preview(store, text: str, effective_day: str, today: date | None = None) -> dict[str, Any]:
    """What uploading this file from `effective_day` would do. Writes nothing."""
    from ..analytics import plan as plan_mod

    today = today or date.today()
    effective = _check_day(effective_day)
    fmt, rows = read_plan(text, today)
    incoming = [r for r in rows if r.day >= effective]
    if not incoming:
        raise PlanUploadError(
            f"that file holds no sessions on or after {effective}, so nothing would take over"
        )
    replaced = _live_after(store, effective)
    old_race = plan_mod.goal_race(store, today)
    new_race = _race_in(incoming)
    return {
        "format": fmt,
        "effective_day": effective,
        "sessions": len(incoming),
        "skipped_before": len(rows) - len(incoming),
        "first_day": min(r.day for r in incoming),
        "last_day": max(r.day for r in incoming),
        "replaced": replaced["calendar"],
        "own_removed": replaced["own"],
        "race": new_race,
        # The one surprise worth a warning: a plan without the race has no countdown.
        "race_lost": old_race is not None
        and old_race["date"] >= effective
        and (new_race is None or new_race["date"] != old_race["date"]),
        "past_kept": _live_before(store, effective),
    }


def _live_after(store, effective: str) -> dict[str, int]:
    row = store.query(
        "SELECT SUM(CASE WHEN s.uid LIKE 'own:%' THEN 0 ELSE 1 END) AS calendar, "
        "       SUM(CASE WHEN s.uid LIKE 'own:%' THEN 1 ELSE 0 END) AS own "
        "FROM plan_sessions s LEFT JOIN plan_edits e ON e.plan_session_id = s.id "
        "WHERE s.withdrawn_at IS NULL AND COALESCE(e.day, s.day) >= ?",
        (effective,),
    )[0]
    return {"calendar": int(row["calendar"] or 0), "own": int(row["own"] or 0)}


def _live_before(store, effective: str) -> int:
    return int(
        store.scalar(
            "SELECT COUNT(*) FROM plan_sessions s LEFT JOIN plan_edits e "
            "ON e.plan_session_id = s.id "
            "WHERE s.withdrawn_at IS NULL AND COALESCE(e.day, s.day) < ?",
            (effective,),
        )
        or 0
    )


def apply(
    store,
    text: str,
    effective_day: str,
    label: str | None = None,
    today: date | None = None,
) -> dict[str, Any]:
    """Make the file the plan from `effective_day`. D31: earlier weeks keep what they had."""
    today = today or date.today()
    summary = preview(store, text, effective_day, today)  # also validates everything
    effective = summary["effective_day"]
    fmt, rows = read_plan(text, today)
    incoming = [r for r in rows if r.day >= effective]

    digest = hashlib.sha256(text.encode("utf-8", "ignore")).hexdigest()[:16]
    previous = plan_ics.get_source(store)
    carried = None if previous is None else previous["start_day"]
    now = plan_ics._utcnow()
    raw_id = store.store_raw("plan_upload", "plan", f"upload-{digest}", {fmt: text})

    with store.tx():
        store.upsert(
            "plan_sources",
            ["kind", "url"],
            {
                "kind": "upload",
                "url": f"upload:{digest}",
                "label": (label or "").strip() or "Uploaded plan",
                "enabled": 1,
                "start_day": carried,
                "last_fetch_at": now,
                "last_error": None,
            },
        )
        source_id = int(store.scalar("SELECT id FROM plan_sources WHERE url = ?", (f"upload:{digest}",)))
        # The old plan and the owner's own sessions stop from the chosen day; earlier days
        # are untouched. Stamped, never deleted.
        store.conn.execute(
            "UPDATE plan_sessions SET withdrawn_at = ? WHERE withdrawn_at IS NULL "
            "AND (source_id IS NULL OR source_id <> ?) AND id IN ("
            "  SELECT s.id FROM plan_sessions s LEFT JOIN plan_edits e ON e.plan_session_id = s.id "
            "  WHERE COALESCE(e.day, s.day) >= ?)",
            (now, source_id, effective),
        )
        store.conn.execute("UPDATE plan_sources SET enabled = 0 WHERE id <> ?", (source_id,))

        seen: set[tuple[str, str]] = set()
        for r in incoming:
            seen.add((r.uid, r.recurrence_id))
            store.upsert(
                "plan_sessions",
                ["source_id", "uid", "recurrence_id"],
                {
                    "source_id": source_id,
                    "uid": r.uid,
                    "recurrence_id": r.recurrence_id,
                    "day": r.day,
                    "start_local": r.start_local,
                    "end_local": r.end_local,
                    "title": r.title,
                    "description": r.description,
                    "parse_status": "unsupported_rrule" if r.unsupported_rrule else "pending",
                    "recurring": 1 if r.recurring else 0,
                    "withdrawn_at": None,
                    "raw_id": raw_id,
                },
            )
        # Uploading the same file again with some sessions removed withdraws those too.
        for old in store.query(
            "SELECT id, uid, recurrence_id FROM plan_sessions "
            "WHERE source_id = ? AND withdrawn_at IS NULL",
            (source_id,),
        ):
            if (old["uid"], old["recurrence_id"]) not in seen:
                store.conn.execute(
                    "UPDATE plan_sessions SET withdrawn_at = ? WHERE id = ?", (now, old["id"])
                )

    plan_ics.apply_parse(store)
    store.set_watermark("plan", last_day=max(r.day for r in incoming))
    log.info("plan uploaded: %d sessions from %s", len(incoming), effective)
    return {"status": "ok", **summary}
