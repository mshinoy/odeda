"""Garmin's official "Export Your Data" ZIP (the GDPR export).

This path needs no credentials and no unofficial API, which makes it the durable
fallback if the Connect login stops working. The trade-off is that the export takes Garmin a few
days to produce and its internal layout changes.

Because the layout changes, this parser does **not** hard-code file paths. It walks
every JSON document in the archive and routes it by *shape*: what keys the records
actually have. A renamed directory therefore costs nothing.

Known shapes it recognises, as of 2026-09:

  DI_CONNECT/DI-Connect-Fitness/*_summarizedActivities.json   activity summaries
  DI_CONNECT/DI-Connect-Wellness/*_sleepData.json             sleep
  DI_CONNECT/DI-Connect-Aggregator/UDSFile_*.json             daily wellness
  DI_CONNECT/DI-Connect-Metrics/MetricsHeartRateVariability*  HRV
  DI_CONNECT/DI-Connect-Wellness/*_weight*.json               body composition
"""

from __future__ import annotations

import json
import logging
import zipfile
from pathlib import Path
from typing import Any, Callable, Iterator, Mapping

from . import normalize as norm

log = logging.getLogger("garmin_analytics.export_zip")

# Shape detectors: (name, predicate on a sample record, normaliser, table)
Shape = tuple[str, Callable[[Mapping[str, Any]], bool], Callable[..., Any], str]


def _has(rec: Mapping[str, Any], *keys: str) -> bool:
    return any(k in rec for k in keys)


SHAPES: list[Shape] = [
    (
        "activities",
        lambda r: _has(r, "activityId") and _has(r, "beginTimestamp", "duration", "activityType"),
        norm.normalize_export_activity,
        "activities",
    ),
    (
        "sleep",
        lambda r: _has(r, "sleepTimeSeconds", "deepSleepSeconds", "dailySleepDTO"),
        norm.normalize_sleep,
        "sleep",
    ),
    (
        "hrv",
        lambda r: _has(r, "lastNightAvg", "hrvSummary") or (
            _has(r, "weeklyAvg") and _has(r, "status")
        ),
        norm.normalize_hrv,
        "hrv_daily",
    ),
    (
        "wellness",
        lambda r: _has(r, "totalSteps", "restingHeartRate", "bodyBatteryHighestValue"),
        norm.normalize_daily_summary,
        "daily_wellness",
    ),
]


def iter_json_documents(
    zip_path: Path | str, skipped: list[str] | None = None
) -> Iterator[tuple[str, Any]]:
    """Yield (member name, decoded JSON) for every JSON member in the archive.

    Members that are not valid JSON are skipped with a warning and recorded in
    `skipped` — the export also contains CSVs, images and, occasionally, an empty file.
    """
    with zipfile.ZipFile(zip_path) as zf:
        for info in zf.infolist():
            if info.is_dir() or not info.filename.lower().endswith(".json"):
                continue
            try:
                with zf.open(info) as fh:
                    yield info.filename, json.loads(fh.read().decode("utf-8-sig"))
            except (json.JSONDecodeError, UnicodeDecodeError) as exc:
                log.warning("skipping %s: %s", info.filename, exc)
                if skipped is not None:
                    skipped.append(info.filename)


WRAPPER_KEYS = (
    "summarizedActivitiesExport",
    "dailySleepDTO",
    "allMetrics",
    "hrvSummaries",
    "dailyWeightSummaries",
)


def records_of(doc: Any) -> list[Mapping[str, Any]]:
    """Flatten the handful of containers Garmin wraps its arrays in.

    The activity export is doubly wrapped — a list holding one object holding the
    array (`[{"summarizedActivitiesExport": [...]}]`) — so a list has to be unwrapped
    again, not just returned as-is.
    """
    if isinstance(doc, list):
        out: list[Mapping[str, Any]] = []
        for item in doc:
            if not isinstance(item, Mapping):
                continue
            if any(isinstance(item.get(k), list) for k in WRAPPER_KEYS):
                out.extend(records_of(item))
            else:
                out.append(item)
        return out
    if isinstance(doc, Mapping):
        for key in WRAPPER_KEYS:
            inner = doc.get(key)
            if isinstance(inner, list):
                return [r for r in inner if isinstance(r, Mapping)]
            if isinstance(inner, Mapping):
                return [doc]
        return [doc]
    return []


def detect_shape(records: list[Mapping[str, Any]]) -> Shape | None:
    """Classify a document by inspecting its first few records."""
    for rec in records[:5]:
        for shape in SHAPES:
            if shape[1](rec):
                return shape
    return None


def import_zip(store, zip_path: Path | str, limit_members: int | None = None) -> dict[str, Any]:
    """Load an export ZIP: archive every document raw, then normalise what we recognise."""
    from ..analytics import load as load_mod

    zip_path = Path(zip_path)
    if not zip_path.exists():
        raise FileNotFoundError(zip_path)

    counts: dict[str, int] = {}
    unrecognised: list[str] = []
    skipped: list[str] = []
    members = 0

    with store.tx():
        for member, doc in iter_json_documents(zip_path, skipped):
            members += 1
            if limit_members and members > limit_members:
                break

            # Raw-first: archived whether or not we know what it is.
            raw_id = store.store_raw("export_zip", "document", member, doc)

            records = records_of(doc)
            if not records:
                continue
            shape = detect_shape(records)
            if shape is None:
                unrecognised.append(member)
                continue

            name, _pred, normalizer, table = shape
            # Weight lives inside a wrapper the generic flattener would destroy.
            written = 0
            for rec in records:
                row = normalizer(rec)
                if not row:
                    continue
                rows = row if isinstance(row, list) else [row]
                for r in rows:
                    if not r:
                        continue
                    if table == "activities":
                        if not r.get("activity_id") or not r.get("day"):
                            continue
                        r["trimp"] = load_mod.activity_trimp(r, {}, store.settings)
                        r["raw_id"] = raw_id
                        store.upsert("activities", ["activity_id"], r)
                        written += 1
                    else:
                        if not r.get("day"):
                            continue
                        store.upsert(table, ["day"], {**r, "raw_id": raw_id})
                        written += 1
            counts[name] = counts.get(name, 0) + written

        # Weight is handled separately: its wrapper shape is unlike the others.
        for member, doc in iter_json_documents(zip_path):
            if not isinstance(doc, Mapping) or "dailyWeightSummaries" not in doc:
                continue
            raw_id = store.store_raw("export_zip", "body", member, doc)
            for row in norm.normalize_weight(doc):
                if row.get("day"):
                    store.upsert("body_composition", ["day"], {**row, "raw_id": raw_id})
                    counts["body"] = counts.get("body", 0) + 1

        store.set_watermark("export_zip", None, "ok", f"imported {zip_path.name}")

    return {
        "zip": zip_path.name,
        "members_scanned": members,
        "written": counts,
        "unrecognised": unrecognised[:20],
        "unrecognised_count": len(unrecognised),
        "undecodable": skipped[:20],
        "undecodable_count": len(skipped),
    }
