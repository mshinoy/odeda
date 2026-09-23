"""The editable-field registry, and the view that resolves user edits.

Design note (this is the bit most likely to be silently broken, so it is explicit):

    * `activities` holds **what Garmin said**. A sync may rewrite any row in it.
    * `overrides` holds **what the user said**, one row per (activity, field).
    * `v_activities` is the only thing anything else should read. Every overridable
      column comes out as ``COALESCE(override, garmin_value)``.

Because sync writes `activities` and the user writes `overrides`, a sync
*cannot* clobber an edit — there is no code path where it would even touch it.

Adding a new editable field is one entry in `FIELDS`. The view DDL, the API
schema, the validation and the UI editor are all generated from it; nothing else
needs to change.
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from typing import Any, Sequence

#: Activity types offered in the type dropdown. These are the values
#: `ingest/normalize.TYPE_MAP` actually produces, so the dropdown shows what the
#: data really contains rather than a plausible-looking list that matches nothing.
#:
#: Deliberately *not* a hard constraint: Garmin's vocabulary is open and it adds
#: sports every year. `EditableField.strict_choices` is False for this field, so an
#: unrecognised type round-trips instead of being rejected.
ACTIVITY_TYPES = (
    "running",
    "treadmill_running",
    "cycling",
    "indoor_cycling",
    "swimming",
    "walking",
    "strength_training",
    "other",
)


@dataclass(frozen=True)
class EditableField:
    """One user-editable field on an activity."""

    name: str
    #: text | real | int | bool — how `overrides.value` is cast back out of TEXT.
    type: str
    #: Column in `activities` this overrides, or None for a field Garmin never supplies
    #: (notes, RPE, private, exclude-from-stats) which therefore lives only in overrides.
    base_column: str | None
    label: str
    #: UI hint. text | textarea | select | number | bool
    editor: str = "text"
    choices: Sequence[str] | None = None
    #: When False, `choices` is a UI suggestion list rather than a validation rule.
    #: Needed wherever the upstream vocabulary is open-ended.
    strict_choices: bool = True
    minimum: float | None = None
    maximum: float | None = None
    help: str = ""

    @property
    def user_only(self) -> bool:
        return self.base_column is None

    @property
    def sql_cast(self) -> str:
        return {
            "text": "TEXT",
            "real": "REAL",
            "int": "INTEGER",
            "bool": "INTEGER",
        }[self.type]

    def coerce(self, value: Any) -> Any:
        """Cast an incoming JSON value to this field's Python type, or raise ValueError."""
        if value is None:
            return None
        if self.type == "bool":
            if isinstance(value, bool):
                return int(value)
            if isinstance(value, (int, float)):
                return int(bool(value))
            s = str(value).strip().lower()
            if s in ("1", "true", "yes", "on"):
                return 1
            if s in ("0", "false", "no", "off", ""):
                return 0
            raise ValueError(f"{self.name}: expected a boolean, got {value!r}")
        if self.type == "int":
            try:
                out: Any = int(value)
            except (TypeError, ValueError):
                raise ValueError(f"{self.name}: expected an integer, got {value!r}") from None
        elif self.type == "real":
            try:
                out = float(value)
            except (TypeError, ValueError):
                raise ValueError(f"{self.name}: expected a number, got {value!r}") from None
        else:
            out = str(value)
            if not out.strip():
                # An empty string is how the UI says "clear this"; treat it as a revert.
                return None
        if self.minimum is not None and out < self.minimum:
            raise ValueError(f"{self.name}: must be >= {self.minimum}")
        if self.maximum is not None and out > self.maximum:
            raise ValueError(f"{self.name}: must be <= {self.maximum}")
        if self.strict_choices and self.choices and str(out) not in self.choices:
            raise ValueError(f"{self.name}: must be one of {', '.join(self.choices)}")
        return out

    def to_json(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "type": self.type,
            "label": self.label,
            "editor": self.editor,
            "choices": list(self.choices) if self.choices else None,
            "min": self.minimum,
            "max": self.maximum,
            "user_only": self.user_only,
            "help": self.help,
        }


#: The registry. Add a line here to make another field editable.
FIELDS: tuple[EditableField, ...] = (
    EditableField(
        name="activity_name",
        type="text",
        base_column="activity_name",
        label="Title",
        editor="text",
        help="Garmin's auto-generated titles are rarely what you would call it.",
    ),
    EditableField(
        name="activity_type",
        type="text",
        base_column="activity_type",
        label="Activity type",
        editor="select",
        choices=ACTIVITY_TYPES,
        strict_choices=False,
        help="Fix a run the watch recorded as a walk.",
    ),
    EditableField(
        name="notes",
        type="text",
        base_column=None,
        label="Notes",
        editor="textarea",
        help="How it actually felt. Never touched by a sync.",
    ),
    EditableField(
        name="rpe",
        type="int",
        base_column=None,
        label="Perceived effort (RPE)",
        editor="number",
        minimum=1,
        maximum=10,
        help="1 = trivial, 10 = maximal. Your own read, not the watch's.",
    ),
    EditableField(
        name="private",
        type="bool",
        base_column=None,
        label="Private",
        editor="bool",
        help="Marks the activity private. Purely a local flag.",
    ),
    EditableField(
        name="excluded_from_stats",
        type="bool",
        base_column=None,
        label="Exclude from stats",
        editor="bool",
        help="For the time the watch was left running in the car. "
        "Excluded activities stay visible but leave every aggregate alone.",
    ),
)

FIELDS_BY_NAME: dict[str, EditableField] = {f.name: f for f in FIELDS}
OVERRIDABLE_BASE_COLUMNS: dict[str, EditableField] = {
    f.base_column: f for f in FIELDS if f.base_column
}


def activities_columns(conn: sqlite3.Connection) -> list[str]:
    """Real column names on `activities`, straight from the database.

    Introspected rather than hardcoded so adding a column to the table does not
    also mean editing the view definition.
    """
    return [r[1] for r in conn.execute("PRAGMA table_info(activities)")]


def build_view_sql(base_columns: Sequence[str]) -> str:
    """Generate `v_activities`: the effective, edit-resolved read model.

    Output columns are named exactly as on `activities`, so a query can move from
    ``FROM activities`` to ``FROM v_activities`` and change nothing else.
    """
    selects: list[str] = []
    joins: list[str] = []

    for col in base_columns:
        fld = OVERRIDABLE_BASE_COLUMNS.get(col)
        if fld is None:
            selects.append(f"a.{col} AS {col}")
        else:
            alias = f"o_{fld.name}"
            selects.append(
                f"COALESCE(CAST({alias}.value AS {fld.sql_cast}), a.{col}) AS {col}"
            )

    for fld in FIELDS:
        alias = f"o_{fld.name}"
        joins.append(
            f"LEFT JOIN overrides {alias} "
            f"ON {alias}.activity_id = a.activity_id AND {alias}.field = '{fld.name}'"
        )
        if fld.user_only:
            selects.append(f"CAST({alias}.value AS {fld.sql_cast}) AS {fld.name}")

    # Convenience columns the UI needs on every row.
    selects.append(
        "(SELECT COUNT(*) FROM overrides ox WHERE ox.activity_id = a.activity_id) "
        "AS override_count"
    )
    selects.append(
        "(SELECT group_concat(ag.gear_id) FROM activity_gear ag "
        "WHERE ag.activity_id = a.activity_id) AS gear_ids"
    )
    selects.append(
        "(SELECT rm.route_id FROM route_members rm WHERE rm.activity_id = a.activity_id) "
        "AS route_id"
    )

    body = ",\n       ".join(selects)
    join_sql = "\n".join(joins)
    return (
        "CREATE VIEW v_activities AS\n"
        f"SELECT {body}\n"
        "FROM activities a\n"
        f"{join_sql};"
    )


#: Every aggregate reads this, not `v_activities`, so an excluded activity is
#: invisible to statistics while still being visible in the activities list.
INCLUDED_VIEW_SQL = (
    "CREATE VIEW v_activities_included AS\n"
    "SELECT * FROM v_activities WHERE COALESCE(excluded_from_stats, 0) = 0;"
)


def _normalise(sql: str) -> str:
    return " ".join(sql.split()).rstrip(";")


def _stored_view_sql(conn: sqlite3.Connection, name: str) -> str | None:
    row = conn.execute(
        "SELECT sql FROM sqlite_master WHERE type = 'view' AND name = ?", (name,)
    ).fetchone()
    return None if row is None or row[0] is None else str(row[0])


def rebuild_views(conn: sqlite3.Connection, force: bool = False) -> bool:
    """Make the edit-resolved views match the current `FIELDS` registry.

    The registry is the source of truth, so the view must never drift from it — but
    the views are only dropped and recreated when the definition has actually
    *changed*. Rebuilding unconditionally would mean a schema write on every
    connection open, and the dashboard opens several concurrently; two of them
    dropping the same view at once is a write-lock race and an intermittent 500.

    Returns True if anything was rewritten.
    """
    wanted = build_view_sql(activities_columns(conn))
    if not force:
        have_main = _stored_view_sql(conn, "v_activities")
        have_inc = _stored_view_sql(conn, "v_activities_included")
        if (
            have_main is not None
            and have_inc is not None
            and _normalise(have_main) == _normalise(wanted)
            and _normalise(have_inc) == _normalise(INCLUDED_VIEW_SQL)
        ):
            return False

    conn.execute("DROP VIEW IF EXISTS v_activities_included")
    conn.execute("DROP VIEW IF EXISTS v_activities")
    conn.execute(wanted)
    conn.execute(INCLUDED_VIEW_SQL)
    return True


def fields_json() -> list[dict[str, Any]]:
    """The registry, for the UI to build its editors from."""
    return [f.to_json() for f in FIELDS]
