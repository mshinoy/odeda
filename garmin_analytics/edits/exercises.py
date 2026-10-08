"""Exercise relabels: the user's correction of what Garmin thought a set was.

Garmin's watch guesses an exercise from the movement and gets it wrong often enough
to matter — about a sixth of the owner's exercises come back as `UNKNOWN`, and some
of the named ones are plainly not what was done (leg extensions filed under `CRUNCH`).
A relabel says what it really was, so the exercise table and the muscles a session
worked are right.

It lives in the same `overrides` table as every other user edit, under the field name
``exercise:<index>``, where the index is the position in the raw payload's
``summarizedExerciseSets``. No schema change, and the same guarantee as every other
edit: sync writes `activities` and `raw_documents`, the user writes `overrides`, so a
re-sync cannot undo a relabel.

These field names are deliberately **not** in the editable-field registry
(`db/fields.py`): they are not activity fields, there is an unbounded number of them,
and the activity Edit dialog must not grow a row per set. `overrides.list_overrides`
skips them and this module owns them instead.

The vocabulary is not validated against a fixed list, for the same reason
`activity_type` is not: Garmin adds exercises every year, and a relabel the server
rejects is a correction the user cannot make. Only the shape is checked.
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from typing import Any

from ..db.store import Store, utcnow

#: Field-name prefix in `overrides` for an exercise relabel.
RELABEL_PREFIX = "exercise:"

#: A Garmin exercise constant: upper snake case, as `summarizedExerciseSets` sends them.
_TOKEN = re.compile(r"^[A-Z0-9_]{1,64}$")


class BadRelabel(ValueError):
    """The relabel is not a `CATEGORY` or `CATEGORY/SUB_CATEGORY` pair."""


def relabel_field(index: int) -> str:
    return f"{RELABEL_PREFIX}{int(index)}"


def is_relabel(field: str) -> bool:
    return field.startswith(RELABEL_PREFIX)


def relabel_index(field: str) -> int | None:
    """The exercise index a relabel field points at, or None if it is not one."""
    if not is_relabel(field):
        return None
    try:
        return int(field[len(RELABEL_PREFIX) :])
    except ValueError:
        return None


def format_label(category: str | None, sub_category: str | None = None) -> str | None:
    """`("DEADLIFT", "ROMANIAN_DEADLIFT")` -> `"DEADLIFT/ROMANIAN_DEADLIFT"`."""
    if not category:
        return None
    return f"{category}/{sub_category}" if sub_category else category


def parse_label(value: str | None) -> tuple[str | None, str | None]:
    """The stored value back into `(category, sub_category)`."""
    if not value:
        return None, None
    category, _, sub = value.partition("/")
    return category or None, sub or None


def clean_label(category: Any, sub_category: Any = None) -> str:
    """Validate a relabel's shape and return what to store, or raise `BadRelabel`."""
    cat = str(category or "").strip().upper()
    sub = str(sub_category or "").strip().upper()
    if not _TOKEN.match(cat):
        raise BadRelabel(f"category must be an exercise constant like BENCH_PRESS, got {category!r}")
    if sub and not _TOKEN.match(sub):
        raise BadRelabel(
            f"sub_category must be an exercise constant like ROMANIAN_DEADLIFT, got {sub_category!r}"
        )
    label = format_label(cat, sub or None)
    assert label is not None  # cat is non-empty by the check above
    return label


def list_relabels(store: Store, activity_id: str) -> dict[int, dict[str, Any]]:
    """Every relabel on one activity, by exercise index."""
    return relabels_for(store, [activity_id]).get(activity_id, {})


def relabels_for(
    store: Store, activity_ids: Sequence[str]
) -> dict[str, dict[int, dict[str, Any]]]:
    """Every relabel on each of `activity_ids`, by activity and then exercise index, in
    one query. An activity with none is absent."""
    if not activity_ids:
        return {}
    rows = store.query(
        "SELECT activity_id, field, value, garmin_value_at_edit, created_at, updated_at "
        f"FROM overrides WHERE activity_id IN ({','.join('?' * len(activity_ids))}) "
        "AND field LIKE ?",
        (*activity_ids, f"{RELABEL_PREFIX}%"),
    )
    out: dict[str, dict[int, dict[str, Any]]] = {}
    for row in rows:
        index = relabel_index(row["field"])
        if index is not None:
            activity_id = row.pop("activity_id")
            out.setdefault(activity_id, {})[index] = row
    return out


def set_relabel(
    store: Store, activity_id: str, index: int, label: str, garmin_label: str | None
) -> dict[str, Any]:
    """Store a relabel. `garmin_label` is what the payload says, kept for the revert."""
    field = relabel_field(index)
    now = utcnow()
    existing = store.conn.execute(
        "SELECT created_at, garmin_value_at_edit FROM overrides "
        "WHERE activity_id = ? AND field = ?",
        (activity_id, field),
    ).fetchone()
    store.conn.execute(
        """
        INSERT INTO overrides (activity_id, field, value, value_type,
                               garmin_value_at_edit, created_at, updated_at)
        VALUES (?, ?, ?, 'text', ?, ?, ?)
        ON CONFLICT (activity_id, field) DO UPDATE SET
            value = excluded.value,
            updated_at = excluded.updated_at
        """,
        (
            activity_id,
            field,
            label,
            # As for field edits: the first thing Garmin said is what a revert offers,
            # however many times the user changes their mind afterwards.
            existing["garmin_value_at_edit"] if existing else garmin_label,
            existing["created_at"] if existing else now,
            now,
        ),
    )
    store.conn.commit()
    return {"activity_id": activity_id, "index": index, "label": label}


def clear_relabel(store: Store, activity_id: str, index: int) -> bool:
    """Drop a relabel so Garmin's own guess shows through again."""
    cur = store.conn.execute(
        "DELETE FROM overrides WHERE activity_id = ? AND field = ?",
        (activity_id, relabel_field(index)),
    )
    store.conn.commit()
    return cur.rowcount > 0


def count(store: Store) -> int:
    """How many relabels exist, for the edits summary."""
    return int(
        store.scalar(
            "SELECT COUNT(*) FROM overrides WHERE field LIKE ?", (f"{RELABEL_PREFIX}%",)
        )
        or 0
    )
