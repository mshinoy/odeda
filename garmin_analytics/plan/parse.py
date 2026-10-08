"""Turning the calendar's prose into a prescription.

The owner writes the plan for a human to read, so the text says more than a number: it
quotes Hal Higdon's prescription alongside the one actually set, marks a week as a taper,
and puts the week's targets on Monday because the club's recurring entries cannot carry
different text each week. All of that has to survive being read by a program.

Three layers, tried in order, most trusted first.

1. **A `GA:` hint line** — `GA: fri sport=run dist=18km kind=long`. Exact, and the only
   form that is. Nothing else in the text can override it.
2. **The week note** on Monday's event: `|| FRI - DBRC long run: target 18 km (Higdon
   prescribes 11.3 …) ||`. Each `||` segment names the days it applies to.
3. **The event's own title**, which is often enough on its own: `Easy run 6.4 km`.

Anything left unresolved is `unparsed` and says so. A plan whose numbers are a guess is
worse than one with holes in it, because the holes are visible in Settings and the
guesses are not.

**Every distance needs an explicit unit.** The gym event's description is 2.5 KB of
routine containing `1x4-6`, `2x10-12` and `8-10 per leg`; a bare-number reader finds an
8-10 km run in a set of step-ups.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, replace
from typing import Iterable, Mapping

#: Weekday tokens as the owner writes them, mapped to `datetime.weekday()`.
WEEKDAYS = {
    "MON": 0, "TUE": 1, "WED": 2, "THU": 3, "FRI": 4, "SAT": 5, "SUN": 6,
}

SPORT_RUN = "running"
SPORT_RIDE = "cycling"
SPORT_GYM = "strength"
SPORT_REST = "rest"

#: Title and description keywords, longest-first where they overlap. `LONG RUN` has to
#: be tested before `RUN`, and `EASY SPIN` before `SPIN`.
_SPORT_WORDS: tuple[tuple[str, str], ...] = (
    ("RACE", SPORT_RUN),
    ("HALF MARATHON", SPORT_RUN),
    ("LONG RUN", SPORT_RUN),
    ("EASY RUN", SPORT_RUN),
    ("RUN", SPORT_RUN),
    ("JOG", SPORT_RUN),
    ("RIDE", SPORT_RIDE),
    ("BIKING", SPORT_RIDE),
    ("BIKE", SPORT_RIDE),
    ("CYCLE", SPORT_RIDE),
    ("SPIN", SPORT_RIDE),
    ("GYM", SPORT_GYM),
    ("STRENGTH", SPORT_GYM),
    ("LIFT", SPORT_GYM),
    ("REST", SPORT_REST),
)

#: The half marathon, in metres. A race title naming the distance gets it exactly rather
#: than through the kilometre parser, which would read "Half Marathon" as no distance.
HALF_MARATHON_M = 21097.5

#: Phrases that introduce the number the owner intends to run. Checked in this order, so
#: `target 18 km (Higdon prescribes 11.3)` resolves to 18 and never to 11.3.
_TARGET_CUES = ("TARGET", "CLUB DOES", "CLUB RUNS", "BUILD TOWARD", "BUILD TO")

#: Phrases that introduce a number quoted for reference only. Everything from the cue to
#: the next clause boundary is removed before any distance is looked for.
_REFERENCE_CUES = ("HIGDON SAYS", "HIGDON PRESCRIBES", "HIGDON ASKS", "PLAN ASKS")

_PAREN = re.compile(r"\([^)]*\)")
#: A parenthetical that *quotes* someone else's prescription, as opposed to one of the
#: owner's own annotations. `(recovery)` and `(easy week)` are his; `(Higdon prescribes
#: 10K race …)` is not, and reading a kind out of it turned a recovery long run into a
#: race.
_REFERENCE_PAREN = re.compile(
    r"\([^)]*(?:%s)[^)]*\)" % "|".join(c.replace(" ", r"\s+") for c in
                                       ("HIGDON", "PLAN ASKS")),
    re.IGNORECASE,
)
_REFERENCE_CLAUSE = re.compile(
    r"(?:%s)\b[^;.|]*" % "|".join(c.replace(" ", r"\s+") for c in _REFERENCE_CUES),
    re.IGNORECASE,
)

#: `18 km`, `14-15 km`, `8–10 km` (en dash), `6.4km`, `5 k`, `10K`. The unit is required.
_DISTANCE = re.compile(
    r"(?P<lo>\d+(?:\.\d+)?)\s*(?:[-–—]\s*(?P<hi>\d+(?:\.\d+)?))?\s*(?P<unit>km|k|m)\b",
    re.IGNORECASE,
)
#: `45 min`, `1h30`, `90 minutes`.
_DURATION = re.compile(
    r"(?:(?P<h>\d+)\s*h(?:ours?)?\s*(?P<hm>\d+)?|(?P<m>\d+)\s*(?:min|minutes?)\b)",
    re.IGNORECASE,
)

_HINT = re.compile(r"^\s*GA:\s*(?P<body>.+?)\s*$", re.IGNORECASE | re.MULTILINE)

#: An optional session is not owed. Counting a skipped one as missed makes the plan
#: punish the owner for following it.
_OPTIONAL = re.compile(r"\boptional\b", re.IGNORECASE)

_KIND_WORDS: tuple[tuple[str, str], ...] = (
    ("RACE", "race"),
    ("LONG RUN", "long"),
    ("LONG", "long"),
    ("TAPER", "taper"),
    ("RECOVERY", "recovery"),
    ("EASY", "easy"),
    ("REST", "rest"),
)


@dataclass(frozen=True)
class Prescription:
    """What a day asks for. `None` everywhere means the text said nothing usable."""

    sport: str | None = None
    kind: str | None = None
    min_m: float | None = None
    max_m: float | None = None
    duration_s: float | None = None
    optional: bool = False
    #: Which layer produced it: `hint` · `week-note` · `title` · `description`.
    source: str = ""

    @property
    def empty(self) -> bool:
        return self.sport is None and self.min_m is None and self.duration_s is None

    def merged_under(self, other: "Prescription") -> "Prescription":
        """`self` wins; `other` fills the gaps. Used to let a title supply the sport
        when the week note gave only a distance."""
        return Prescription(
            sport=self.sport or other.sport,
            kind=self.kind or other.kind,
            min_m=self.min_m if self.min_m is not None else other.min_m,
            max_m=self.max_m if self.max_m is not None else other.max_m,
            duration_s=self.duration_s if self.duration_s is not None else other.duration_s,
            optional=self.optional or other.optional,
            source=self.source or other.source,
        )


# ---------------------------------------------------------------------------
# Pieces
# ---------------------------------------------------------------------------


def find_sport(text: str) -> str | None:
    upper = text.upper()
    for word, sport in _SPORT_WORDS:
        if re.search(rf"\b{re.escape(word)}\b", upper):
            return sport
    return None


def find_kind(text: str) -> str | None:
    upper = text.upper()
    for word, kind in _KIND_WORDS:
        if re.search(rf"\b{re.escape(word)}\b", upper):
            return kind
    return None


def strip_reference(text: str) -> str:
    """Remove what is quoted rather than prescribed.

    Two different things get removed and the distinction matters: a parenthetical that
    names Higdon is a reference, while `(recovery)` and `(easy week)` are the owner's
    own annotations and are the only place a week's character is written down. Stripping
    every parenthetical lost the first; stripping none of them let `(Higdon prescribes
    10K race)` turn 25 December's recovery long run into a race.
    """
    return _REFERENCE_CLAUSE.sub(" ", _REFERENCE_PAREN.sub(" ", text))


def strip_for_distance(text: str) -> str:
    """As `strip_reference`, and then every remaining parenthetical: an aside holding a
    number is never this session's target."""
    return _PAREN.sub(" ", strip_reference(text))


def find_distance(text: str) -> tuple[float | None, float | None]:
    """Metres, as a (min, max) pair. A single value sets both.

    Looks after a target cue first — `target 18 km`, `club does 8-10 km` — and only then
    anywhere in the text, so a sentence holding both the owner's number and someone
    else's resolves to the owner's.
    """
    cleaned = strip_for_distance(text)
    for cue in _TARGET_CUES:
        match = re.search(rf"{cue.replace(' ', r'\s+')}\b(?P<rest>[^;.|]*)", cleaned, re.IGNORECASE)
        if match:
            found = _first_distance(match.group("rest"))
            if found != (None, None):
                return found
    if re.search(r"\bHALF\s+MARATHON\b", cleaned, re.IGNORECASE):
        return HALF_MARATHON_M, HALF_MARATHON_M
    return _first_distance(cleaned)


def _first_distance(text: str) -> tuple[float | None, float | None]:
    match = _DISTANCE.search(text)
    if not match:
        return None, None
    unit = match.group("unit").lower()
    scale = 1.0 if unit == "m" else 1000.0
    # Rounded because 16.1 * 1000 is 16100.000000000002 in binary floating point, and a
    # target that fails an equality check against itself is a target nobody can test.
    lo = round(float(match.group("lo")) * scale, 1)
    hi = round(float(match.group("hi")) * scale, 1) if match.group("hi") else lo
    return lo, hi


def find_duration(text: str) -> float | None:
    match = _DURATION.search(strip_for_distance(text))
    if not match:
        return None
    if match.group("m"):
        return float(match.group("m")) * 60.0
    hours = float(match.group("h"))
    minutes = float(match.group("hm") or 0)
    return hours * 3600.0 + minutes * 60.0


# ---------------------------------------------------------------------------
# Layer 1 — hint lines
# ---------------------------------------------------------------------------


def parse_hints(text: str) -> dict[int | None, Prescription]:
    """`GA: fri sport=run dist=18km kind=long` → `{4: Prescription(...)}`.

    A hint with no weekday applies to the event it is written on, keyed `None`. This is
    the only exact layer: everything else is inference over prose the owner wrote for
    themselves, and when the two disagree the hint is right by definition.
    """
    out: dict[int | None, Prescription] = {}
    for match in _HINT.finditer(text or ""):
        body = match.group("body")
        day: int | None = None
        fields: dict[str, str] = {}
        for token in body.split():
            if "=" in token:
                key, _, value = token.partition("=")
                fields[key.strip().lower()] = value.strip()
            elif token.strip(",").upper()[:3] in WEEKDAYS:
                day = WEEKDAYS[token.strip(",").upper()[:3]]
        if not fields:
            continue
        lo, hi = _first_distance(fields.get("dist", ""))
        sport = fields.get("sport")
        out[day] = Prescription(
            sport=_canonical_sport(sport) if sport else None,
            kind=fields.get("kind"),
            min_m=lo,
            max_m=hi,
            duration_s=find_duration(fields.get("time", "")) if fields.get("time") else None,
            optional=fields.get("optional", "").lower() in ("1", "true", "yes"),
            source="hint",
        )
    return out


def _canonical_sport(word: str) -> str | None:
    return find_sport(word) or {"run": SPORT_RUN, "ride": SPORT_RIDE, "gym": SPORT_GYM}.get(
        word.lower()
    )


# ---------------------------------------------------------------------------
# Layer 2 — the week note on Monday's event
# ---------------------------------------------------------------------------


def parse_week_note(description: str) -> dict[int, Prescription]:
    """Read `|| FRI - DBRC long run: target 18 km || SUN = rest ||` into per-day targets.

    This layer exists because the club's Tuesday and Friday entries are one recurring
    series each and cannot say anything different week to week. The owner therefore puts
    the week's numbers on Monday. Without this, every Friday in the plan reads as the
    same prescription and the long-run progression — the entire point of the block — is
    invisible to the app.

    A segment may name several days (`WED Lusail ride + SAT Olympic ride`), in which case
    each named day gets it.
    """
    out: dict[int, Prescription] = {}
    if not description or "||" not in description:
        return out

    for segment in description.split("||"):
        for clause in _sentences(segment):
            days = _days_named(clause)
            if not days:
                continue
            sport = find_sport(strip_reference(clause))
            lo, hi = find_distance(clause)
            kind = find_kind(strip_reference(clause))
            if sport is None and lo is None and kind is None:
                continue
            pres = Prescription(
                sport=SPORT_REST if kind == "rest" else sport,
                kind=kind,
                min_m=lo,
                max_m=hi,
                duration_s=find_duration(clause),
                optional=bool(_OPTIONAL.search(clause)),
                source="week-note",
            )
            for day in days:
                # A later clause naming the same day refines an earlier one rather than
                # replacing it; the first mention is the specific one in this calendar.
                out[day] = out[day].merged_under(pres) if day in out else pres
    return out


#: Split on a full stop followed by space, and nothing else. A `||` segment can hold two
#: sentences about different days — `WED Lusail ride + SAT Olympic ride = Higdon
#: cross-training. SUN = rest.` — and reading it whole gave Wednesday and Saturday
#: Sunday's rest day. Semicolons are deliberately *not* split on: `Higdon says 7.2 km;
#: club does 8-10 km` is one thought, and splitting it strands the club distance in a
#: clause that names no day. The lookbehind requires whitespace after the stop, so the
#: decimal point in `7.2 km` is left alone.
_SENTENCE = re.compile(r"(?<=\.)\s+")


def _sentences(segment: str) -> list[str]:
    return [part for part in _SENTENCE.split(segment) if part.strip()]


def _days_named(segment: str) -> list[int]:
    """Weekday tokens anywhere in the segment, in the order they appear.

    Matched on a word boundary against the three-letter form, so `SUN = rest` and
    `SUN rest` both count and `Sunday` would too — but `sundry` would not.
    """
    found: list[int] = []
    for match in re.finditer(r"\b(MON|TUE|WED|THU|FRI|SAT|SUN)[A-Z]*\b", segment.upper()):
        day = WEEKDAYS[match.group(1)]
        if day not in found:
            found.append(day)
    return found


# ---------------------------------------------------------------------------
# Layer 3 — the event's own text
# ---------------------------------------------------------------------------


def parse_event(title: str, description: str = "") -> Prescription:
    """What this one event says, before any week note is applied.

    The title is trusted over the description: `Easy run 6.4 km` is a prescription, while
    a description is often standing advice repeated on every instance of a series — the
    Friday long run's text explains the whole block's philosophy and names six distances,
    none of which are this week's.
    """
    title = (title or "").strip()
    description = description or ""

    hints = parse_hints(f"{title}\n{description}")
    if None in hints:
        return hints[None]
    if hints:
        # A day-qualified hint on this event is still exact for this event when it is
        # the only one; ambiguity here would be the owner's, not the parser's.
        return next(iter(hints.values()))

    sport = find_sport(title)
    lo, hi = find_distance(title)
    kind = find_kind(title)
    optional = bool(_OPTIONAL.search(title))

    if sport is None:
        sport = find_sport(description)
    if kind is None:
        kind = find_kind(title) or None

    # Only consult the description for a number when the title gave none *and* the
    # description is short enough to be about this session rather than a standing note.
    if lo is None and description and len(description) <= 300 and "||" not in description:
        lo, hi = find_distance(description)

    if sport == SPORT_REST or kind == "rest":
        return Prescription(sport=SPORT_REST, kind="rest", source="title")

    return Prescription(
        sport=sport,
        kind=kind,
        min_m=lo,
        max_m=hi,
        duration_s=find_duration(title) if lo is None else None,
        optional=optional or bool(_OPTIONAL.search(description[:300])),
        source="title" if (sport or lo) else "",
    )


# ---------------------------------------------------------------------------
# Putting it together
# ---------------------------------------------------------------------------


def resolve(
    title: str,
    description: str,
    weekday: int,
    week_note: Mapping[int, Prescription] | None = None,
) -> tuple[Prescription, str]:
    """The prescription for one session, and its `parse_status`.

    Precedence: a hint on the event, then the week note for this weekday, then the
    event's own title. The week note outranks the title because that is where the owner
    writes the number they actually intend — the title on a recurring series is fixed
    text that cannot know which week it is.
    """
    own = parse_event(title, description)
    if own.source == "hint":
        return own, "ok"

    noted = (week_note or {}).get(weekday)
    # The note is written per *day*, but a day can hold two sports — every Monday here
    # is an easy run and a gym session. Applying the day's note to both gave the gym a
    # 7.2 km target. So a note speaks only for an event of the same sport, or for one
    # whose own text named no sport.
    #
    # Note the asymmetry: a note that itself names no sport (`MON (today): 7.2 km easy.`
    # says nothing about running) does *not* get to claim an event that does. Reading it
    # the other way was the bug — "no sport stated" is not "any sport".
    if noted is not None and (own.sport is None or own.sport == noted.sport):
        combined = noted.merged_under(own)
        return combined, "ok" if _usable(combined) else "unparsed"

    return own, "ok" if _usable(own) else "unparsed"


def _usable(pres: Prescription) -> bool:
    """A prescription is usable when it says what to do. A distance is not required:
    `rest` and a gym session are complete without one, and so is a club run whose
    distance lives on Monday's event."""
    return pres.sport is not None


def week_notes_by_week(sessions: Iterable[Mapping[str, object]]) -> dict[str, dict[int, Prescription]]:
    """Index every week note by the ISO year-week it governs.

    Keyed on the *note's own* week rather than on the Monday it sits on, so a note moved
    to a different day still applies to the week it describes.
    """
    from datetime import date

    out: dict[str, dict[int, Prescription]] = {}
    for row in sessions:
        description = str(row.get("description") or "")
        if "||" not in description:
            continue
        parsed = parse_week_note(description)
        if not parsed:
            continue
        day = date.fromisoformat(str(row["day"]))
        year, week, _ = day.isocalendar()
        key = f"{year}-W{week:02d}"
        out[key] = {**out.get(key, {}), **parsed}
    return out
