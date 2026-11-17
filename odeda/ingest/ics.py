"""An iCalendar reader that covers this calendar and refuses the rest.

RFC 5545 is a large specification and almost none of it is in play here: the input is
one Google Calendar the owner keeps by hand, holding weekly training sessions. So this
reads the subset that calendar actually uses — `FREQ=WEEKLY` and `FREQ=DAILY`, with
`INTERVAL`, `BYDAY`, `COUNT`, `UNTIL`, `EXDATE` and `RECURRENCE-ID` — and raises
`UnsupportedRecurrence` for anything else. D10.

**Refusing is the whole point.** A monthly rule expanded as if it were weekly produces
plausible sessions on days nobody trained, and the adherence number built on them looks
exactly like a real one. A rule this module does not understand becomes a single stored
session flagged `unsupported_rrule`, which is visible in Settings, rather than a guess
that is invisible everywhere.

Expansion happens in the series' **own** time zone and in wall-clock time: a weekly
session at 05:00 is at 05:00 next week, whatever happened to the offset in between.
`Asia/Qatar` has no daylight saving, so none of that bites here today — but the code
does not depend on that, because the owner's calendar is portable and this app is meant
to be run by other people.

Stdlib only (D7, D10).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Iterator, Sequence
from zoneinfo import ZoneInfo

#: Weekday codes, in the order `datetime.weekday()` uses.
WEEKDAYS = ("MO", "TU", "WE", "TH", "FR", "SA", "SU")
_WEEKDAY_INDEX = {code: i for i, code in enumerate(WEEKDAYS)}

#: Expanding a series is bounded. A malformed or hostile rule with no COUNT and no
#: UNTIL would otherwise run to the end of the window one week at a time; the window is
#: already finite, but a daily rule across a decade is 3,650 rows nobody asked for.
MAX_INSTANCES = 5000

#: The parts this module understands. A rule naming anything else is refused whole,
#: rather than expanded while quietly dropping the part that narrowed it — dropping
#: `BYMONTHDAY` from a rule turns 12 sessions a year into 365.
SUPPORTED_RRULE_PARTS = frozenset({"FREQ", "INTERVAL", "COUNT", "UNTIL", "BYDAY", "WKST"})
SUPPORTED_FREQUENCIES = frozenset({"DAILY", "WEEKLY"})


class IcsError(ValueError):
    """The feed is not iCalendar, or is truncated."""


class UnsupportedRecurrence(ValueError):
    """A recurrence rule outside the subset above. Carries the rule, for the UI."""

    def __init__(self, rule: str, reason: str) -> None:
        super().__init__(f"{reason}: {rule}")
        self.rule = rule
        self.reason = reason


# ---------------------------------------------------------------------------
# Lines
# ---------------------------------------------------------------------------


def unfold(text: str) -> list[str]:
    """Join continuation lines. A content line may be split anywhere, with the
    continuation marked by a leading space or tab — including in the middle of a word,
    or of an escape sequence, which is why this happens before any other parsing."""
    out: list[str] = []
    for raw in text.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        if raw[:1] in (" ", "\t") and out:
            out[-1] += raw[1:]
        elif raw:
            out.append(raw)
    return out


@dataclass(frozen=True)
class ContentLine:
    name: str
    params: dict[str, str]
    value: str


def _split_params(segment: str) -> tuple[str, dict[str, str]]:
    """`DTSTART;TZID=Asia/Qatar` → `("DTSTART", {"TZID": "Asia/Qatar"})`."""
    parts = segment.split(";")
    params: dict[str, str] = {}
    for part in parts[1:]:
        key, _, val = part.partition("=")
        params[key.upper()] = val.strip('"')
    return parts[0].upper(), params


def parse_line(line: str) -> ContentLine:
    """Split a content line at the first colon that is not inside a quoted parameter."""
    in_quotes = False
    for i, ch in enumerate(line):
        if ch == '"':
            in_quotes = not in_quotes
        elif ch == ":" and not in_quotes:
            name, params = _split_params(line[:i])
            return ContentLine(name, params, line[i + 1 :])
    raise IcsError(f"content line has no value: {line[:60]!r}")


_UNESCAPE = {"n": "\n", "N": "\n", ",": ",", ";": ";", "\\": "\\"}


def unescape(value: str) -> str:
    """`\\n` is a newline, `\\,` a comma. Google escapes descriptions heavily, and the
    plan's own text — "Tue: 8-10 km; Fri: 18 km" — is full of the characters that get
    escaped, so getting this wrong corrupts exactly the text T36 has to read."""
    out: list[str] = []
    i = 0
    while i < len(value):
        ch = value[i]
        if ch == "\\" and i + 1 < len(value):
            nxt = value[i + 1]
            out.append(_UNESCAPE.get(nxt, nxt))
            i += 2
        else:
            out.append(ch)
            i += 1
    return "".join(out)


# ---------------------------------------------------------------------------
# Dates
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Moment:
    """A point in a calendar: naive wall time plus the zone it is wall time *in*.

    Kept apart rather than collapsed into an aware datetime because recurrence is
    defined on the wall clock. Adding seven days to an aware datetime adds seven
    *absolute* days, which in a zone with daylight saving moves a 05:00 session to
    04:00 or 06:00. Adding them to the naive value and attaching the zone afterwards is
    what a calendar means by "weekly".
    """

    naive: datetime
    tz: ZoneInfo
    all_day: bool = False

    def aware(self) -> datetime:
        return self.naive.replace(tzinfo=self.tz)

    def shifted(self, delta: timedelta) -> "Moment":
        return Moment(self.naive + delta, self.tz, self.all_day)

    def in_zone(self, tz: ZoneInfo) -> "Moment":
        if self.all_day or tz is self.tz:
            return Moment(self.naive, tz, self.all_day)
        return Moment(self.aware().astimezone(tz).replace(tzinfo=None), tz, self.all_day)

    @property
    def day(self) -> date:
        return self.naive.date()

    def ics(self) -> str:
        """The form used as a recurrence identity: `20261030T050000`, or `20261030`."""
        return self.naive.strftime("%Y%m%d") if self.all_day else self.naive.strftime("%Y%m%dT%H%M%S")


def parse_moment(line: ContentLine, default_tz: ZoneInfo) -> Moment:
    """`DTSTART;TZID=Asia/Qatar:20261030T050000`, `...:20261030T020000Z`, or a date."""
    value = line.value.strip()
    if line.params.get("VALUE") == "DATE" or (len(value) == 8 and "T" not in value):
        return Moment(datetime.strptime(value, "%Y%m%d"), default_tz, all_day=True)
    tzid = line.params.get("TZID")
    if value.endswith("Z"):
        return Moment(datetime.strptime(value, "%Y%m%dT%H%M%SZ"), ZoneInfo("UTC"))
    naive = datetime.strptime(value, "%Y%m%dT%H%M%S")
    # No TZID and no Z is a "floating" time, which means whatever zone the viewer is
    # in. The calendar's own zone is the only honest reading of that here.
    return Moment(naive, ZoneInfo(tzid) if tzid else default_tz)


_DURATION = re.compile(
    r"^(?P<sign>[+-])?P(?:(?P<weeks>\d+)W)?(?:(?P<days>\d+)D)?"
    r"(?:T(?:(?P<hours>\d+)H)?(?:(?P<minutes>\d+)M)?(?:(?P<seconds>\d+)S)?)?$"
)


def parse_duration(value: str) -> timedelta:
    m = _DURATION.match(value.strip())
    if not m:
        raise IcsError(f"unreadable DURATION: {value!r}")
    parts = {k: int(v) for k, v in m.groupdict().items() if k != "sign" and v}
    delta = timedelta(
        weeks=parts.get("weeks", 0),
        days=parts.get("days", 0),
        hours=parts.get("hours", 0),
        minutes=parts.get("minutes", 0),
        seconds=parts.get("seconds", 0),
    )
    return -delta if m.group("sign") == "-" else delta


# ---------------------------------------------------------------------------
# Recurrence
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Recurrence:
    freq: str
    interval: int = 1
    count: int | None = None
    until: datetime | None = None  # aware, UTC
    byday: tuple[str, ...] = ()
    raw: str = ""


def parse_rrule(value: str) -> Recurrence:
    """Read the supported subset, or raise. Never silently drops a part."""
    parts: dict[str, str] = {}
    for chunk in value.split(";"):
        if not chunk:
            continue
        key, _, val = chunk.partition("=")
        parts[key.strip().upper()] = val.strip()

    unknown = set(parts) - SUPPORTED_RRULE_PARTS
    if unknown:
        raise UnsupportedRecurrence(value, f"unsupported rule parts {sorted(unknown)}")

    freq = parts.get("FREQ", "").upper()
    if freq not in SUPPORTED_FREQUENCIES:
        raise UnsupportedRecurrence(value, f"unsupported FREQ {freq or '(missing)'}")

    interval = int(parts.get("INTERVAL", "1"))
    if interval < 1:
        raise UnsupportedRecurrence(value, "INTERVAL below 1")

    byday = tuple(d.strip().upper() for d in parts["BYDAY"].split(",")) if "BYDAY" in parts else ()
    for day in byday:
        # `2FR` means "the second Friday"; that is a BYDAY this module does not do.
        if day not in _WEEKDAY_INDEX:
            raise UnsupportedRecurrence(value, f"unsupported BYDAY {day}")
    if byday and freq == "DAILY":
        raise UnsupportedRecurrence(value, "BYDAY with FREQ=DAILY")

    # WKST only changes the result when BYDAY is combined with INTERVAL > 1, because
    # that is when "which week" depends on where the week starts. Anywhere else it is
    # noise, and Google sends it on rules where it is noise.
    wkst = parts.get("WKST", "MO").upper()
    if wkst != "MO" and interval > 1 and byday:
        raise UnsupportedRecurrence(value, f"WKST={wkst} with INTERVAL>1")

    until: datetime | None = None
    if "UNTIL" in parts:
        raw_until = parts["UNTIL"]
        if raw_until.endswith("Z"):
            until = datetime.strptime(raw_until, "%Y%m%dT%H%M%SZ").replace(tzinfo=ZoneInfo("UTC"))
        elif len(raw_until) == 8:
            until = datetime.strptime(raw_until, "%Y%m%d").replace(tzinfo=ZoneInfo("UTC"))
        else:
            until = datetime.strptime(raw_until, "%Y%m%dT%H%M%S").replace(tzinfo=ZoneInfo("UTC"))

    count = int(parts["COUNT"]) if "COUNT" in parts else None
    return Recurrence(freq, interval, count, until, byday, raw=value)


def _weekly_starts(start: Moment, rule: Recurrence) -> Iterator[Moment]:
    """Every occurrence of a weekly rule, in order, unbounded.

    `BYDAY` with several days means several per week, which is how one series covers
    "Tuesday and Thursday". The week is anchored on the Monday of DTSTART's week, so
    `INTERVAL=2` skips whole weeks rather than drifting by day.
    """
    days = rule.byday or (WEEKDAYS[start.naive.weekday()],)
    offsets = sorted(_WEEKDAY_INDEX[d] for d in days)
    week_start = start.naive - timedelta(days=start.naive.weekday())
    step = timedelta(weeks=rule.interval)
    guard = 0
    while guard < MAX_INSTANCES:
        for offset in offsets:
            moment = Moment(week_start + timedelta(days=offset), start.tz, start.all_day)
            if moment.naive >= start.naive:
                guard += 1
                yield moment
        week_start += step


def _daily_starts(start: Moment, rule: Recurrence) -> Iterator[Moment]:
    step = timedelta(days=rule.interval)
    moment = start
    for _ in range(MAX_INSTANCES):
        yield moment
        moment = moment.shifted(step)


def expand_rrule(start: Moment, rule: Recurrence, window_end: datetime) -> list[Moment]:
    """Occurrences from DTSTART up to `window_end` (aware), honouring COUNT and UNTIL.

    COUNT is counted before the window is applied, which is what the spec means: a rule
    with `COUNT=12` has twelve occurrences whether or not the window shows them all.
    """
    starts = _weekly_starts(start, rule) if rule.freq == "WEEKLY" else _daily_starts(start, rule)
    out: list[Moment] = []
    for n, moment in enumerate(starts):
        if rule.count is not None and n >= rule.count:
            break
        if rule.until is not None and moment.aware() > rule.until:
            break
        if moment.aware() > window_end:
            break
        out.append(moment)
    return out


# ---------------------------------------------------------------------------
# Events
# ---------------------------------------------------------------------------


@dataclass
class VEvent:
    uid: str
    start: Moment
    end: Moment | None = None
    summary: str = ""
    description: str = ""
    rrule: str = ""
    exdates: set[str] = field(default_factory=set)
    recurrence_id: str | None = None
    cancelled: bool = False

    @property
    def duration(self) -> timedelta | None:
        if self.end is None:
            return None
        return self.end.naive - self.start.naive


@dataclass(frozen=True)
class Instance:
    """One prescribed session: a point in time plus the text attached to it."""

    uid: str
    recurrence_id: str
    start: Moment
    end: Moment | None
    summary: str
    description: str
    unsupported_rrule: str = ""
    #: True when this came out of an RRULE series. The matcher needs it: a dated one-off
    #: is a more specific prescription than one instance of a standing weekly entry.
    recurring: bool = False

    @property
    def day(self) -> str:
        return self.start.day.isoformat()


def parse_events(text: str, default_tz: ZoneInfo) -> list[VEvent]:
    """Every VEVENT in the feed. VTIMEZONE blocks are skipped: the zone names are read
    with `zoneinfo`, which has the real rules, rather than from the feed's own copy."""
    lines = unfold(text)
    if not any(line.startswith("BEGIN:VCALENDAR") for line in lines):
        raise IcsError("not an iCalendar document")

    events: list[VEvent] = []
    current: dict[str, object] | None = None
    depth_other = 0

    for raw in lines:
        if raw == "BEGIN:VEVENT":
            current = {"exdates": set()}
            continue
        if raw == "END:VEVENT":
            if current is not None:
                events.append(_build_event(current, default_tz))
            current = None
            continue
        if current is None:
            continue
        # A VALARM sits inside a VEVENT and has its own DESCRIPTION and TRIGGER. Reading
        # it would overwrite the session's text with "Reminder".
        if raw.startswith("BEGIN:"):
            depth_other += 1
            continue
        if raw.startswith("END:"):
            depth_other = max(0, depth_other - 1)
            continue
        if depth_other:
            continue

        line = parse_line(raw)
        if line.name == "UID":
            current["uid"] = unescape(line.value)
        elif line.name == "DTSTART":
            current["start"] = parse_moment(line, default_tz)
        elif line.name == "DTEND":
            current["end"] = parse_moment(line, default_tz)
        elif line.name == "DURATION":
            current["duration"] = parse_duration(line.value)
        elif line.name == "SUMMARY":
            current["summary"] = unescape(line.value)
        elif line.name == "DESCRIPTION":
            current["description"] = unescape(line.value)
        elif line.name == "RRULE":
            current["rrule"] = line.value.strip()
        elif line.name == "EXDATE":
            for piece in line.value.split(","):
                moment = parse_moment(ContentLine("EXDATE", line.params, piece), default_tz)
                current["exdates"].add(moment.ics())  # type: ignore[union-attr]
        elif line.name == "RECURRENCE-ID":
            current["recurrence_id"] = parse_moment(line, default_tz).ics()
        elif line.name == "STATUS":
            current["cancelled"] = line.value.strip().upper() == "CANCELLED"

    return events


def _build_event(fields: dict[str, object], default_tz: ZoneInfo) -> VEvent:
    start = fields.get("start")
    if not isinstance(start, Moment):
        raise IcsError("VEVENT without DTSTART")
    end = fields.get("end")
    if end is None and isinstance(fields.get("duration"), timedelta):
        end = start.shifted(fields["duration"])  # type: ignore[arg-type]
    return VEvent(
        uid=str(fields.get("uid") or ""),
        start=start,
        end=end if isinstance(end, Moment) else None,
        summary=str(fields.get("summary") or ""),
        description=str(fields.get("description") or ""),
        rrule=str(fields.get("rrule") or ""),
        exdates=fields.get("exdates") or set(),  # type: ignore[arg-type]
        recurrence_id=fields.get("recurrence_id"),  # type: ignore[arg-type]
        cancelled=bool(fields.get("cancelled")),
    )


def expand(
    events: Sequence[VEvent],
    window_end: datetime,
    display_tz: ZoneInfo,
    window_start: datetime | None = None,
) -> list[Instance]:
    """Turn events into the sessions they prescribe, overrides and deletions applied.

    Order matters and is the whole correctness story: a series is expanded first, then
    its `EXDATE`s remove instances, then any VEVENT carrying a `RECURRENCE-ID` replaces
    the generated instance with that identity. An override that moves a session to a
    different day keeps the *original* instance's recurrence id, because that is what
    identifies which occurrence was moved — using the new time would leave the old one
    standing and create a duplicate.
    """
    overrides: dict[tuple[str, str], VEvent] = {}
    cancelled: set[tuple[str, str]] = set()
    for event in events:
        if event.recurrence_id is None:
            continue
        key = (event.uid, event.recurrence_id)
        if event.cancelled:
            cancelled.add(key)
        else:
            overrides[key] = event

    out: list[Instance] = []
    seen: set[tuple[str, str]] = set()

    for event in events:
        if event.recurrence_id is not None or event.cancelled:
            continue

        if event.rrule:
            try:
                starts = expand_rrule(event.start, parse_rrule(event.rrule), window_end)
            except UnsupportedRecurrence as exc:
                # Stored once, at DTSTART, flagged. Never expanded on a guess.
                out.append(_instance(event, event.start, display_tz, unsupported=exc.rule))
                continue
        else:
            starts = [event.start]

        for moment in starts:
            rid = moment.ics()
            key = (event.uid, rid)
            if rid in event.exdates or key in cancelled or key in seen:
                continue
            seen.add(key)
            override = overrides.get(key)
            if override is not None:
                out.append(_instance(override, override.start, display_tz, rid=rid))
            else:
                out.append(_instance(event, moment, display_tz, rid=rid))

    if window_start is not None:
        out = [i for i in out if i.start.aware() >= window_start]
    return sorted(out, key=lambda i: (i.start.naive, i.uid))


def _instance(
    event: VEvent,
    moment: Moment,
    display_tz: ZoneInfo,
    rid: str | None = None,
    unsupported: str = "",
) -> Instance:
    duration = event.duration
    local = moment.in_zone(display_tz)
    return Instance(
        uid=event.uid,
        recurrence_id=rid or moment.ics(),
        recurring=bool(event.rrule) or rid is not None,
        start=local,
        end=local.shifted(duration) if duration is not None else None,
        summary=event.summary,
        description=event.description,
        unsupported_rrule=unsupported,
    )
