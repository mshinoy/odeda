"""Fitbit's data export, as delivered by Google Takeout.

This path needs no credential, no client id and no rate limit, which makes it three
things at once: the fallback if Google retires the Web API, the fastest way to load a
decade of weigh-ins, and the only route that works at all before the owner has
registered an app.

Like `export_zip.py` — Garmin's equivalent — it routes documents by **shape** rather
than by path. Takeout's directory names have already changed twice and will again;
a renamed folder must cost nothing.

Two things about this export are traps, and both are handled here rather than assumed
away.

**The date format is American.** `03/01/19` in a Fitbit export is 1 March 2019, not
3 January. Read as ISO or as day-first it produces a plausible, wrong date that nothing
downstream can detect.

**The weight may be in pounds.** The export follows the account's original unit
setting, not the app's current one, and it does not say which it used. Guessing from
the number is impossible — 75 and 175 are both plausible human weights. So the unit is
inferred from the record's *own* BMI: weight and BMI together imply a height, and a
weight in pounds implies a height around 2.6 m. That is not a judgement call about the
athlete, it is arithmetic that cannot be true.
"""

from __future__ import annotations

import csv
import io
import json
import logging
import math
import re
import zipfile
from pathlib import Path
from typing import Any, Iterator, Mapping

from . import normalize as norm

log = logging.getLogger("odeda.fitbit_export")

SOURCE = "fitbit_export"

#: Archived under the same endpoint name as the live sync, because it is the same data
#: and `GET /api/raw/{endpoint}/{ref_key}` should find either.
ENDPOINT = "fitbit_body"

#: The *watermark* is separate. `fitbit_body`'s watermark is the live sync's resume
#: cursor; writing "I imported a ZIP" into it would send the next sync back to the
#: start of the account, and a ZIP's coverage is not a day the sync has reached.
WATERMARK = "fitbit_export"

KG_PER_LB = 0.45359237

#: Heights a living adult can have, in metres. The unit check asks what height the
#: record's own weight and BMI imply and rejects the answer if it is not one of these.
MIN_HEIGHT_M = 1.20
MAX_HEIGHT_M = 2.30

#: Weights a scale reading can plausibly be, in kilograms, after conversion. A row
#: outside this is a parse failure wearing a number, not an unusual athlete.
MIN_WEIGHT_KG = 25.0
MAX_WEIGHT_KG = 300.0


# ---------------------------------------------------------------------------
# Dates
# ---------------------------------------------------------------------------

_ISO = re.compile(r"^(\d{4})-(\d{2})-(\d{2})")
_SLASHED = re.compile(r"^(\d{1,2})/(\d{1,2})/(\d{2,4})")


def to_iso_date(raw: Any) -> str | None:
    """`03/01/19`, `03/01/2019` and `2019-03-01` all mean 1 March 2019.

    Fitbit's export writes month first. The only case where that is knowably wrong is a
    first field above 12, which can only be a day — some locales' exports do write
    day-first, and a silently transposed date is the kind of bug that survives for
    years because every value it produces looks fine.
    """
    text = str(raw or "").strip()
    if not text:
        return None

    iso = _ISO.match(text)
    if iso:
        return f"{iso.group(1)}-{iso.group(2)}-{iso.group(3)}"

    slashed = _SLASHED.match(text)
    if not slashed:
        return None
    first, second, year_text = (int(slashed.group(1)), int(slashed.group(2)), slashed.group(3))
    month, day = (second, first) if first > 12 else (first, second)
    year = int(year_text)
    if year < 100:
        # Fitbit launched in 2009; a two-digit year is this century.
        year += 2000
    if not (1 <= month <= 12 and 1 <= day <= 31):
        return None
    return f"{year:04d}-{month:02d}-{day:02d}"


# ---------------------------------------------------------------------------
# Units
# ---------------------------------------------------------------------------


def implied_height_m(weight: float, bmi: float) -> float | None:
    """The height a (weight, BMI) pair implies, treating the weight as kilograms."""
    if bmi <= 0 or weight <= 0:
        return None
    return math.sqrt(weight / bmi)


def looks_like_pounds(records: list[Mapping[str, Any]]) -> bool:
    """Decide the unit from the records' own arithmetic, not from a label.

    A weight in pounds divided by a BMI computed from kilograms implies a height
    2.205 times too large in area — about 1.49× in metres — so a 1.79 m athlete comes
    out at 2.66 m. Every record votes, and the majority wins, because one record with a
    BMI of 0 should not be able to convert a decade of history.

    Returns False when nothing can be decided, which keeps the documented default
    (metric) rather than inventing a conversion.
    """
    metric = pounds = 0
    for record in records:
        weight = norm.as_float(norm.pick(record, "weight", "value"))
        bmi = norm.as_float(norm.pick(record, "bmi"))
        if weight is None or bmi is None:
            continue
        height = implied_height_m(weight, bmi)
        if height is None:
            continue
        if MIN_HEIGHT_M <= height <= MAX_HEIGHT_M:
            metric += 1
        elif MIN_HEIGHT_M <= height * math.sqrt(KG_PER_LB) <= MAX_HEIGHT_M:
            pounds += 1
    return pounds > metric


# ---------------------------------------------------------------------------
# Recognising a weight document
# ---------------------------------------------------------------------------


def is_weight_record(record: Mapping[str, Any]) -> bool:
    """A weight log entry: a weight, a date, and something that marks it as a log."""
    has_weight = norm.pick(record, "weight", "value") is not None
    has_date = norm.pick(record, "date", "dateTime", "Date", "timestamp") is not None
    marker = any(k in record for k in ("logId", "bmi", "fat", "source", "time", "logid"))
    return bool(has_weight and has_date and marker)


def records_of(doc: Any) -> list[Mapping[str, Any]]:
    """Flatten the containers Takeout wraps arrays in. A bare array is the common case."""
    if isinstance(doc, list):
        return [r for r in doc if isinstance(r, Mapping)]
    if isinstance(doc, Mapping):
        for key in ("weight", "body", "logs", "data"):
            inner = doc.get(key)
            if isinstance(inner, list):
                return [r for r in inner if isinstance(r, Mapping)]
        return [doc]
    return []


def parse_csv(text: str) -> list[Mapping[str, Any]]:
    """Read the CSV form. Headers are lower-cased so `Date` and `date` are one thing.

    Takeout ships some Fitbit data as CSV and some as JSON, and which is which has
    changed between exports. Both end up as the same records here.
    """
    try:
        rows = list(csv.DictReader(io.StringIO(text)))
    except csv.Error as exc:
        log.warning("unreadable CSV: %s", exc)
        return []
    out: list[Mapping[str, Any]] = []
    for row in rows:
        lowered = {
            (key or "").strip().lower().replace(" ", "_"): value
            for key, value in row.items()
            if key
        }
        # `body_fat` and `fat` are the same column under two export vintages.
        if "body_fat" in lowered and "fat" not in lowered:
            lowered["fat"] = lowered["body_fat"]
        out.append(lowered)
    return out


def iter_members(zip_path: Path | str, skipped: list[str] | None = None) -> Iterator[
    tuple[str, list[Mapping[str, Any]], Any]
]:
    """Yield (member name, records, the document as archived) for every JSON or CSV.

    The third element is what gets archived raw: for JSON that is the decoded document
    verbatim, for CSV the parsed rows, because storing a CSV as one string makes the
    archive unqueryable for no benefit.
    """
    with zipfile.ZipFile(zip_path) as zf:
        for info in zf.infolist():
            name = info.filename
            lowered = name.lower()
            if info.is_dir() or not (lowered.endswith(".json") or lowered.endswith(".csv")):
                continue
            try:
                blob = zf.read(info).decode("utf-8-sig")
            except (UnicodeDecodeError, zipfile.BadZipFile) as exc:
                log.warning("skipping %s: %s", name, exc)
                if skipped is not None:
                    skipped.append(name)
                continue

            if lowered.endswith(".csv"):
                records = parse_csv(blob)
                yield name, records, records
                continue
            try:
                doc = json.loads(blob)
            except json.JSONDecodeError as exc:
                log.warning("skipping %s: %s", name, exc)
                if skipped is not None:
                    skipped.append(name)
                continue
            yield name, records_of(doc), doc


# ---------------------------------------------------------------------------
# Import
# ---------------------------------------------------------------------------


def canonical_records(
    records: list[Mapping[str, Any]], in_pounds: bool
) -> list[dict[str, Any]]:
    """Export records -> the shape the API returns, so one normaliser serves both.

    This is the only place the export's quirks live. Everything after it — the D5
    earliest-of-the-day rule, the missing-fat rule, the rounding — is
    `normalize_fitbit_weight`, shared with the live sync, so the two paths cannot
    disagree about a kilogram or about which reading of a day counts.
    """
    out: list[dict[str, Any]] = []
    for record in records:
        day = to_iso_date(norm.pick(record, "date", "dateTime", "timestamp"))
        weight = norm.as_float(norm.pick(record, "weight", "value"))
        if not day or weight is None:
            continue
        kg = weight * KG_PER_LB if in_pounds else weight
        if not (MIN_WEIGHT_KG <= kg <= MAX_WEIGHT_KG):
            # Not a strange athlete: a column read as the wrong thing entirely.
            log.warning("ignoring an implausible weight of %.1f kg on %s", kg, day)
            continue
        out.append(
            {
                "date": day,
                "weight": kg,
                "fat": norm.as_float(norm.pick(record, "fat")),
                "bmi": norm.as_float(norm.pick(record, "bmi")),
                "time": str(norm.pick(record, "time") or ""),
            }
        )
    return out


def import_fitbit_export(store, zip_path: Path | str) -> dict[str, Any]:
    """Load weigh-ins out of a Fitbit export ZIP. No network, no credential.

    Raw-first, like every other ingest path: a recognised document is archived verbatim
    before anything is parsed, so correcting a parsing mistake later never means asking
    Google for the export again — which takes days.
    """
    zip_path = Path(zip_path)
    if not zip_path.exists():
        raise FileNotFoundError(zip_path)

    members = 0
    written = 0
    recognised: list[str] = []
    unrecognised: list[str] = []
    skipped: list[str] = []
    units: set[str] = set()

    with store.tx():
        for name, records, document in iter_members(zip_path, skipped):
            members += 1
            weights = [r for r in records if is_weight_record(r)]
            if not weights:
                unrecognised.append(name)
                continue

            raw_id = store.store_raw(SOURCE, ENDPOINT, name, document)
            in_pounds = looks_like_pounds(weights)
            units.add("lb" if in_pounds else "kg")
            rows = norm.normalize_fitbit_weight(canonical_records(weights, in_pounds))
            for row in rows:
                store.upsert("body_composition", ["day"], {**row, "raw_id": raw_id})
            written += len(rows)
            recognised.append(name)

        store.set_watermark(
            WATERMARK, None, "ok", f"imported {written} weigh-ins from {zip_path.name}"
        )

    return {
        "zip": zip_path.name,
        "members_scanned": members,
        "written": written,
        "units_found": sorted(units),
        "recognised": recognised[:20],
        "unrecognised": unrecognised[:20],
        "unrecognised_count": len(unrecognised),
        "undecodable": skipped[:20],
        "undecodable_count": len(skipped),
    }
