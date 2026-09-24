"""Read, write and revert per-activity field overrides.

The contract, restated because it is the thing that must not break:

    set_override() only ever writes to `overrides`.
    Ingestion only ever writes to `activities`.
    Everything that reads activities reads `v_activities`.

So a re-sync physically cannot clobber an edit. `tests/test_overrides.py` proves it
by running a full re-ingest over an edited activity and asserting the edit survived.
"""

from __future__ import annotations

from typing import Any, Sequence

from ..db.fields import FIELDS, FIELDS_BY_NAME, EditableField
from ..db.store import Store, utcnow
from . import exercises as relabels_mod


class UnknownField(KeyError):
    """Raised when a field is not in the editable registry."""


def _field(name: str) -> EditableField:
    try:
        return FIELDS_BY_NAME[name]
    except KeyError:
        raise UnknownField(
            f"{name!r} is not editable; editable fields are: "
            f"{', '.join(sorted(FIELDS_BY_NAME))}"
        ) from None


def _garmin_value(store: Store, activity_id: str, fld: EditableField) -> Any:
    """What Garmin currently says for this field, or None for user-only fields."""
    if fld.base_column is None:
        return None
    row = store.conn.execute(
        f"SELECT {fld.base_column} AS v FROM activities WHERE activity_id = ?",
        (activity_id,),
    ).fetchone()
    return None if row is None else row["v"]


def activity_exists(store: Store, activity_id: str) -> bool:
    return (
        store.conn.execute(
            "SELECT 1 FROM activities WHERE activity_id = ?", (activity_id,)
        ).fetchone()
        is not None
    )


def effective(store: Store, activity_id: str) -> dict[str, Any] | None:
    """The activity as the user should see it: Garmin values with edits applied."""
    row = store.conn.execute(
        "SELECT * FROM v_activities WHERE activity_id = ?", (activity_id,)
    ).fetchone()
    return dict(row) if row else None


def list_overrides(store: Store, activity_id: str) -> list[dict[str, Any]]:
    """Every *field* edit on one activity, each with the Garmin value it is masking.

    Exercise relabels share the table but are not activity fields, so they are left
    out here and reported on the exercises themselves (`edits/exercises.py`).
    """
    rows = store.query(
        "SELECT field, value, value_type, garmin_value_at_edit, created_at, updated_at "
        "FROM overrides WHERE activity_id = ? AND field NOT LIKE ? ORDER BY field",
        (activity_id, f"{relabels_mod.RELABEL_PREFIX}%"),
    )
    out: list[dict[str, Any]] = []
    for r in rows:
        fld = FIELDS_BY_NAME.get(r["field"])
        out.append(
            {
                **r,
                "label": fld.label if fld else r["field"],
                "current_garmin_value": _garmin_value(store, activity_id, fld) if fld else None,
                "revertible": True,
            }
        )
    return out


def set_override(store: Store, activity_id: str, name: str, value: Any) -> dict[str, Any]:
    """Record a user edit. Returns the stored row.

    Passing None (or an empty string for a text field) reverts instead: the user
    clearing a box means "go back to what Garmin said", not "store an empty value".
    """
    fld = _field(name)
    if not activity_exists(store, activity_id):
        raise LookupError(f"no activity {activity_id!r}")

    coerced = fld.coerce(value)
    if coerced is None:
        revert(store, activity_id, name)
        return {"activity_id": activity_id, "field": name, "value": None, "reverted": True}

    garmin_now = _garmin_value(store, activity_id, fld)
    now = utcnow()
    existing = store.conn.execute(
        "SELECT created_at, garmin_value_at_edit FROM overrides "
        "WHERE activity_id = ? AND field = ?",
        (activity_id, name),
    ).fetchone()

    store.conn.execute(
        """
        INSERT INTO overrides (activity_id, field, value, value_type,
                               garmin_value_at_edit, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (activity_id, field) DO UPDATE SET
            value = excluded.value,
            value_type = excluded.value_type,
            updated_at = excluded.updated_at
        """,
        (
            activity_id,
            name,
            str(coerced),
            fld.type,
            # Keep the original snapshot: the first thing Garmin said is what
            # "revert" should offer, even after several rounds of editing.
            existing["garmin_value_at_edit"] if existing else (
                None if garmin_now is None else str(garmin_now)
            ),
            existing["created_at"] if existing else now,
            now,
        ),
    )
    store.conn.commit()
    return {
        "activity_id": activity_id,
        "field": name,
        "value": coerced,
        "value_type": fld.type,
        "garmin_value": garmin_now,
        "updated_at": now,
        "reverted": False,
    }


def revert(store: Store, activity_id: str, name: str) -> bool:
    """Drop an override so the Garmin value shows through again."""
    _field(name)
    cur = store.conn.execute(
        "DELETE FROM overrides WHERE activity_id = ? AND field = ?", (activity_id, name)
    )
    store.conn.commit()
    return cur.rowcount > 0


def revert_all(store: Store, activity_id: str) -> int:
    """Drop every field edit on the activity.

    Exercise relabels are left alone: "revert all" is the Edit dialog's button, the
    dialog counts only the field edits it shows, and silently throwing away work done
    on another screen would be the worst kind of surprise. Each relabel reverts from
    its own row.
    """
    cur = store.conn.execute(
        "DELETE FROM overrides WHERE activity_id = ? AND field NOT LIKE ?",
        (activity_id, f"{relabels_mod.RELABEL_PREFIX}%"),
    )
    store.conn.commit()
    return cur.rowcount


def set_many(
    store: Store, activity_id: str, values: dict[str, Any]
) -> list[dict[str, Any]]:
    """Apply several field edits to one activity (what the drawer's Save does)."""
    return [set_override(store, activity_id, k, v) for k, v in values.items()]


def bulk_set(
    store: Store, activity_ids: Sequence[str], name: str, value: Any
) -> dict[str, Any]:
    """Apply one field edit across many activities (bulk exclude, retype, ...)."""
    _field(name)
    applied, missing = 0, []
    for aid in activity_ids:
        try:
            set_override(store, aid, name, value)
            applied += 1
        except LookupError:
            missing.append(aid)
    return {"field": name, "applied": applied, "missing": missing}


def stats(store: Store) -> dict[str, Any]:
    """Summary for the settings screen: how much of the data the user has corrected.

    Relabels are counted together as `exercise_relabels` rather than appearing in
    `by_field` as one entry per exercise index, which would be a list of noise.
    """
    by_field = store.query(
        "SELECT field, COUNT(*) AS n FROM overrides WHERE field NOT LIKE ? "
        "GROUP BY field ORDER BY n DESC",
        (f"{relabels_mod.RELABEL_PREFIX}%",),
    )
    return {
        "exercise_relabels": relabels_mod.count(store),
        "total": int(store.scalar("SELECT COUNT(*) FROM overrides") or 0),
        "activities_edited": int(
            store.scalar("SELECT COUNT(DISTINCT activity_id) FROM overrides") or 0
        ),
        "by_field": by_field,
        "fields": [f.to_json() for f in FIELDS],
    }
