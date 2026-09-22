"""Gear: shoes, bikes, straps — CRUD, assignment and mileage.

Gear is a user-owned table. A sync may *offer* gear (Garmin exposes it for some
accounts) but it is imported by `garmin_uuid` and never overwrites a manual
assignment: `activity_gear.source` records who decided, and only rows with
source='garmin' or 'default_rule' are ever replaced automatically.

Mileage counts activities through `v_activities_included`, so an activity the user
excluded from stats ("watch left running in the car") does not put phantom
kilometres on their shoes either.
"""

from __future__ import annotations

import sqlite3
from datetime import date, datetime
from typing import Any, Iterable, Mapping, Sequence

from ..db.store import Store, utcnow

#: Kinds we know how to talk about. `other` is the escape hatch.
GEAR_KINDS = ("shoe", "bike", "strap", "other")

#: Fraction of the retirement threshold at which the dashboard starts warning.
WARN_FRACTION = 0.85

#: Assignments a sync or rule is allowed to overwrite. A 'manual' row is sacred.
REPLACEABLE_SOURCES = ("garmin", "default_rule")

_EDITABLE = (
    "kind",
    "brand",
    "model",
    "nickname",
    "purchase_date",
    "initial_distance_m",
    "retirement_distance_m",
    "retired",
    "notes",
    "photo_path",
)

#: What `create()` will take from a request body. Deliberately not `**anything`: a
#: payload key that collides with a parameter name (`store`, `gear_id`) used to reach
#: `create(store, store=1)` and come back as a 500, and a misspelled field used to be
#: accepted and silently dropped.
CREATABLE = (*_EDITABLE, "source", "garmin_uuid")


class GearError(ValueError):
    pass


def clean_attrs(payload: Mapping[str, Any], allowed: Sequence[str]) -> dict[str, Any]:
    """Validate an API payload's keys against `allowed`, or raise GearError."""
    unknown = sorted(k for k in payload if k not in allowed)
    if unknown:
        raise GearError(
            f"unknown gear field(s): {', '.join(unknown)}; "
            f"allowed: {', '.join(sorted(allowed))}"
        )
    return dict(payload)


def display_name(row: dict[str, Any]) -> str:
    """What to show in a dropdown: the nickname if there is one, else brand + model."""
    if row.get("nickname"):
        return str(row["nickname"])
    parts = [str(row.get("brand") or "").strip(), str(row.get("model") or "").strip()]
    name = " ".join(p for p in parts if p)
    return name or f"gear {row.get('gear_id')}"


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------


def create(store: Store, **attrs: Any) -> dict[str, Any]:
    kind = str(attrs.get("kind") or "other").lower()
    if kind not in GEAR_KINDS:
        raise GearError(f"kind must be one of {', '.join(GEAR_KINDS)}, got {kind!r}")
    if not any(attrs.get(k) for k in ("nickname", "brand", "model")):
        raise GearError("gear needs at least a nickname, a brand or a model")

    now = utcnow()
    row = {
        "kind": kind,
        "brand": attrs.get("brand"),
        "model": attrs.get("model"),
        "nickname": attrs.get("nickname"),
        "purchase_date": _iso_date(attrs.get("purchase_date")),
        "initial_distance_m": float(attrs.get("initial_distance_m") or 0.0),
        "retirement_distance_m": _opt_float(attrs.get("retirement_distance_m")),
        "retired": int(bool(attrs.get("retired", 0))),
        "notes": attrs.get("notes"),
        "photo_path": attrs.get("photo_path"),
        "source": attrs.get("source") or "manual",
        "garmin_uuid": attrs.get("garmin_uuid"),
        "created_at": now,
        "updated_at": now,
    }
    try:
        cur = store.conn.execute(
            f"INSERT INTO gear ({', '.join(row)}) VALUES ({', '.join('?' for _ in row)})",
            list(row.values()),
        )
    except sqlite3.IntegrityError as exc:
        # The only UNIQUE constraint is garmin_uuid: importing the same Garmin item
        # twice is a conflict to report, not a crash.
        raise GearError(f"gear conflicts with an existing item: {exc}") from exc
    store.conn.commit()
    return get(store, int(cur.lastrowid))  # type: ignore[arg-type]


def update(store: Store, gear_id: int, **attrs: Any) -> dict[str, Any]:
    current = _raw(store, gear_id)
    if current is None:
        raise LookupError(f"no gear {gear_id}")
    sets: dict[str, Any] = {}
    for key in _EDITABLE:
        if key not in attrs:
            continue
        val = attrs[key]
        if key == "kind":
            val = str(val or "other").lower()
            if val not in GEAR_KINDS:
                raise GearError(f"kind must be one of {', '.join(GEAR_KINDS)}")
        elif key == "purchase_date":
            val = _iso_date(val)
        elif key in ("initial_distance_m",):
            val = float(val or 0.0)
        elif key in ("retirement_distance_m",):
            val = _opt_float(val)
        elif key == "retired":
            val = int(bool(val))
        sets[key] = val
    if not sets:
        return get(store, gear_id)
    sets["updated_at"] = utcnow()
    store.conn.execute(
        f"UPDATE gear SET {', '.join(f'{k} = ?' for k in sets)} WHERE gear_id = ?",
        [*sets.values(), gear_id],
    )
    store.conn.commit()
    return get(store, gear_id)


def delete(store: Store, gear_id: int) -> bool:
    """Delete gear and its assignments. Activities themselves are untouched."""
    cur = store.conn.execute("DELETE FROM gear WHERE gear_id = ?", (gear_id,))
    store.conn.commit()
    return cur.rowcount > 0


def retire(store: Store, gear_id: int, retired: bool = True) -> dict[str, Any]:
    return update(store, gear_id, retired=retired)


def _raw(store: Store, gear_id: int) -> dict[str, Any] | None:
    row = store.conn.execute("SELECT * FROM gear WHERE gear_id = ?", (gear_id,)).fetchone()
    return dict(row) if row else None


def get(store: Store, gear_id: int) -> dict[str, Any]:
    row = _raw(store, gear_id)
    if row is None:
        raise LookupError(f"no gear {gear_id}")
    return _with_mileage(store, row)


def list_gear(
    store: Store, include_retired: bool = True, kind: str | None = None
) -> list[dict[str, Any]]:
    where, params = [], []
    if not include_retired:
        where.append("retired = 0")
    if kind:
        where.append("kind = ?")
        params.append(kind)
    clause = (" WHERE " + " AND ".join(where)) if where else ""
    rows = store.query(f"SELECT * FROM gear{clause} ORDER BY retired, kind, gear_id", params)
    return [_with_mileage(store, r) for r in rows]


# ---------------------------------------------------------------------------
# Mileage
# ---------------------------------------------------------------------------


def _usage(store: Store, gear_id: int) -> dict[str, Any]:
    row = store.conn.execute(
        """
        SELECT COUNT(*)                     AS activity_count,
               COALESCE(SUM(v.distance_m), 0)   AS distance_m,
               COALESCE(SUM(v.moving_time_s), 0) AS moving_time_s,
               COALESCE(SUM(v.elevation_gain_m), 0) AS elevation_gain_m,
               MIN(v.day)                   AS first_use,
               MAX(v.day)                   AS last_use
        FROM activity_gear ag
        JOIN v_activities_included v ON v.activity_id = ag.activity_id
        WHERE ag.gear_id = ?
        """,
        (gear_id,),
    ).fetchone()
    return dict(row) if row else {}


def _with_mileage(store: Store, row: dict[str, Any]) -> dict[str, Any]:
    """Decorate a gear row with its usage, wear state and weekly load."""
    use = _usage(store, int(row["gear_id"]))
    tracked = float(use.get("distance_m") or 0.0)
    initial = float(row.get("initial_distance_m") or 0.0)
    total = initial + tracked
    threshold = row.get("retirement_distance_m")

    pct = None
    state = "retired" if row.get("retired") else "ok"
    if threshold:
        pct = 100.0 * total / float(threshold)
        if not row.get("retired"):
            if pct >= 100.0:
                state = "over"
            elif pct >= WARN_FRACTION * 100.0:
                state = "warn"

    weeks = _weeks_between(use.get("first_use"), use.get("last_use"))
    return {
        **row,
        "display_name": display_name(row),
        "activity_count": int(use.get("activity_count") or 0),
        "tracked_distance_m": round(tracked, 1),
        "total_distance_m": round(total, 1),
        "total_distance_km": round(total / 1000.0, 2),
        "moving_time_s": round(float(use.get("moving_time_s") or 0.0), 1),
        "elevation_gain_m": round(float(use.get("elevation_gain_m") or 0.0), 1),
        "first_use": use.get("first_use"),
        "last_use": use.get("last_use"),
        "retirement_pct": None if pct is None else round(pct, 1),
        "remaining_m": None if not threshold else round(float(threshold) - total, 1),
        "state": state,
        "distance_per_week_km": (
            None if not weeks else round(tracked / 1000.0 / weeks, 2)
        ),
    }


def _weeks_between(first: str | None, last: str | None) -> float | None:
    if not first or not last:
        return None
    try:
        d0 = date.fromisoformat(str(first)[:10])
        d1 = date.fromisoformat(str(last)[:10])
    except ValueError:
        return None
    days = (d1 - d0).days + 1
    return max(days / 7.0, 1.0 / 7.0)


# ---------------------------------------------------------------------------
# Assignment
# ---------------------------------------------------------------------------


def for_activity(store: Store, activity_id: str) -> list[dict[str, Any]]:
    rows = store.query(
        "SELECT g.*, ag.source AS assign_source, ag.assigned_at "
        "FROM activity_gear ag JOIN gear g ON g.gear_id = ag.gear_id "
        "WHERE ag.activity_id = ? ORDER BY g.kind",
        (activity_id,),
    )
    return [{**r, "display_name": display_name(r)} for r in rows]


def assign(
    store: Store,
    activity_id: str,
    gear_id: int,
    source: str = "manual",
    replace_same_kind: bool = True,
) -> dict[str, Any]:
    """Attach gear to an activity, retroactively and at any time.

    `replace_same_kind` is the dropdown semantic: picking a different pair of shoes
    swaps them rather than recording that two pairs were worn at once. Gear of a
    *different* kind (a HR strap on a ride with a bike) is left alone.
    """
    if not _activity_exists(store, activity_id):
        raise LookupError(f"no activity {activity_id!r}")
    row = _raw(store, gear_id)
    if row is None:
        raise LookupError(f"no gear {gear_id}")

    if replace_same_kind:
        store.conn.execute(
            "DELETE FROM activity_gear WHERE activity_id = ? AND gear_id IN "
            "(SELECT gear_id FROM gear WHERE kind = ?)",
            (activity_id, row["kind"]),
        )
    store.upsert(
        "activity_gear",
        ["activity_id", "gear_id"],
        {
            "activity_id": activity_id,
            "gear_id": gear_id,
            "source": source,
            "assigned_at": utcnow(),
        },
    )
    store.conn.commit()
    return {"activity_id": activity_id, "gear": for_activity(store, activity_id)}


def unassign(store: Store, activity_id: str, gear_id: int) -> bool:
    cur = store.conn.execute(
        "DELETE FROM activity_gear WHERE activity_id = ? AND gear_id = ?",
        (activity_id, gear_id),
    )
    store.conn.commit()
    return cur.rowcount > 0


def set_for_activity(
    store: Store, activity_id: str, gear_ids: Sequence[int], source: str = "manual"
) -> dict[str, Any]:
    """Replace an activity's whole gear set (what the drawer's multi-select sends)."""
    if not _activity_exists(store, activity_id):
        raise LookupError(f"no activity {activity_id!r}")
    store.conn.execute("DELETE FROM activity_gear WHERE activity_id = ?", (activity_id,))
    now = utcnow()
    for gid in gear_ids:
        if _raw(store, int(gid)) is None:
            raise LookupError(f"no gear {gid}")
        store.upsert(
            "activity_gear",
            ["activity_id", "gear_id"],
            {
                "activity_id": activity_id,
                "gear_id": int(gid),
                "source": source,
                "assigned_at": now,
            },
        )
    store.conn.commit()
    return {"activity_id": activity_id, "gear": for_activity(store, activity_id)}


def bulk_assign(
    store: Store,
    gear_id: int,
    start: str | None = None,
    end: str | None = None,
    activity_type: str | None = None,
    only_unassigned: bool = False,
    replace_same_kind: bool = True,
    dry_run: bool = False,
) -> dict[str, Any]:
    """Apply gear to every activity matching a filter.

    This is the one that makes importing years of gear-less history bearable:
    "every run between 2023-03-01 and 2023-11-14 was the Novablasts".
    """
    row = _raw(store, gear_id)
    if row is None:
        raise LookupError(f"no gear {gear_id}")

    where, params = ["1 = 1"], []
    if start:
        where.append("v.day >= ?")
        params.append(start)
    if end:
        where.append("v.day <= ?")
        params.append(end)
    if activity_type:
        where.append("v.activity_type = ?")
        params.append(activity_type)
    if only_unassigned:
        where.append(
            "NOT EXISTS (SELECT 1 FROM activity_gear ag "
            "JOIN gear g2 ON g2.gear_id = ag.gear_id "
            "WHERE ag.activity_id = v.activity_id AND g2.kind = ?)"
        )
        params.append(row["kind"])

    matched = store.query(
        f"SELECT v.activity_id FROM v_activities v WHERE {' AND '.join(where)} ORDER BY v.day",
        params,
    )
    ids = [r["activity_id"] for r in matched]
    if dry_run:
        return {"gear_id": gear_id, "matched": len(ids), "applied": 0, "dry_run": True}

    for aid in ids:
        assign(store, aid, gear_id, source="manual", replace_same_kind=replace_same_kind)
    return {
        "gear_id": gear_id,
        "gear": display_name(row),
        "matched": len(ids),
        "applied": len(ids),
        "dry_run": False,
        "filters": {
            "start": start,
            "end": end,
            "activity_type": activity_type,
            "only_unassigned": only_unassigned,
        },
    }


def _activity_exists(store: Store, activity_id: str) -> bool:
    return (
        store.conn.execute(
            "SELECT 1 FROM activities WHERE activity_id = ?", (activity_id,)
        ).fetchone()
        is not None
    )


# ---------------------------------------------------------------------------
# Default rules — new activities only
# ---------------------------------------------------------------------------


def set_default(store: Store, activity_type: str, gear_id: int) -> dict[str, Any]:
    row = _raw(store, gear_id)
    if row is None:
        raise LookupError(f"no gear {gear_id}")
    # One default per (activity_type, kind): choosing new default shoes for runs
    # replaces the old default shoes, not the default HR strap.
    store.conn.execute(
        "DELETE FROM gear_defaults WHERE activity_type = ? AND gear_id IN "
        "(SELECT gear_id FROM gear WHERE kind = ?)",
        (activity_type, row["kind"]),
    )
    store.upsert(
        "gear_defaults",
        ["activity_type", "gear_id"],
        {"activity_type": activity_type, "gear_id": gear_id, "created_at": utcnow()},
    )
    store.conn.commit()
    return {"activity_type": activity_type, "defaults": list_defaults(store)}


def clear_default(store: Store, activity_type: str, gear_id: int) -> bool:
    cur = store.conn.execute(
        "DELETE FROM gear_defaults WHERE activity_type = ? AND gear_id = ?",
        (activity_type, gear_id),
    )
    store.conn.commit()
    return cur.rowcount > 0


def list_defaults(store: Store) -> list[dict[str, Any]]:
    rows = store.query(
        "SELECT d.activity_type, d.gear_id, g.kind, g.brand, g.model, g.nickname "
        "FROM gear_defaults d JOIN gear g ON g.gear_id = d.gear_id "
        "ORDER BY d.activity_type, g.kind"
    )
    return [{**r, "display_name": display_name(r)} for r in rows]


def apply_defaults(store: Store, activity_ids: Iterable[str]) -> int:
    """Apply default gear rules to activities that have none.

    Called by ingestion for newly-seen activities only — never retrospectively,
    because backfilling years of history with today's shoes would be a lie.
    """
    defaults = store.query(
        "SELECT d.activity_type, d.gear_id, g.kind FROM gear_defaults d "
        "JOIN gear g ON g.gear_id = d.gear_id WHERE g.retired = 0"
    )
    if not defaults:
        return 0
    by_type: dict[str, list[dict[str, Any]]] = {}
    for d in defaults:
        by_type.setdefault(d["activity_type"], []).append(d)

    applied = 0
    for aid in activity_ids:
        row = store.conn.execute(
            "SELECT activity_type FROM activities WHERE activity_id = ?", (aid,)
        ).fetchone()
        if row is None:
            continue
        for rule in by_type.get(row["activity_type"], []):
            already = store.conn.execute(
                "SELECT 1 FROM activity_gear ag JOIN gear g ON g.gear_id = ag.gear_id "
                "WHERE ag.activity_id = ? AND g.kind = ?",
                (aid, rule["kind"]),
            ).fetchone()
            if already:
                continue
            assign(store, aid, int(rule["gear_id"]), source="default_rule")
            applied += 1
    return applied


# ---------------------------------------------------------------------------
# Garmin import
# ---------------------------------------------------------------------------


def import_from_garmin(store: Store, payloads: Sequence[dict[str, Any]]) -> dict[str, Any]:
    """Upsert gear Garmin knows about, keyed on its UUID.

    Never touches manual assignments, and never edits a field the user has changed:
    an imported item that already exists locally only gains values it is missing.
    """
    created, updated = 0, 0
    for item in payloads:
        uuid = item.get("uuid") or item.get("gearPk") or item.get("gearUuid")
        if not uuid:
            continue
        existing = store.conn.execute(
            "SELECT * FROM gear WHERE garmin_uuid = ?", (str(uuid),)
        ).fetchone()
        attrs = {
            "kind": _garmin_kind(item),
            "brand": item.get("gearMakeName") or item.get("brand"),
            "model": item.get("gearModelName") or item.get("model"),
            "nickname": item.get("customMakeModel") or item.get("displayName"),
            "purchase_date": _iso_date(item.get("dateBegin") or item.get("purchaseDate")),
            "retirement_distance_m": _opt_float(item.get("maximumMeters")),
            "retired": int(bool(item.get("gearStatusName") == "retired" or item.get("retired"))),
            "garmin_uuid": str(uuid),
            "source": "garmin",
        }
        if existing is None:
            create(store, **attrs)
            created += 1
        else:
            fill = {
                k: v
                for k, v in attrs.items()
                if v not in (None, "") and existing[k] in (None, "")
                and k in _EDITABLE
            }
            if fill:
                update(store, int(existing["gear_id"]), **fill)
                updated += 1
    return {"created": created, "updated": updated, "seen": len(payloads)}


def _garmin_kind(item: dict[str, Any]) -> str:
    raw = str(item.get("gearTypeName") or item.get("classification") or "").lower()
    if "shoe" in raw:
        return "shoe"
    if "bike" in raw or "cycl" in raw:
        return "bike"
    if "strap" in raw or "hrm" in raw:
        return "strap"
    return "other"


# ---------------------------------------------------------------------------


def _iso_date(value: Any) -> str | None:
    if value in (None, ""):
        return None
    text = str(value)
    for parse in (
        lambda s: date.fromisoformat(s[:10]),
        lambda s: datetime.strptime(s[:10], "%d/%m/%Y").date(),
    ):
        try:
            return parse(text).isoformat()
        except ValueError:
            continue
    raise GearError(f"could not read {value!r} as a date (want YYYY-MM-DD)")


def _opt_float(value: Any) -> float | None:
    if value in (None, ""):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        raise GearError(f"expected a number, got {value!r}") from None
