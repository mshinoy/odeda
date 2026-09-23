"""Pydantic models for the typed part of the HTTP API.

These exist so `/openapi.json` describes real shapes and the frontend's generated
types are more than `Record<string, unknown>`. They describe what the handlers
already return; they do not reshape it. Units live in the field names, exactly as in
the database (`distance_m`, `moving_time_s`, `avg_speed_mps`, ...), and values come
out exactly as stored.

Extra keys are ignored (the Pydantic default): a column that exists in the database
but is not declared here is simply not serialised. That is deliberate — adding a
column is then an explicit, reviewed change to the API rather than an accident.

Flags stored as SQLite integers (`private`, `excluded_from_stats`, `retired`) are
declared as `int` (0/1), not `bool`, so the JSON is unchanged from before typing.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict

#: How an editable field's value is cast back out of `overrides.value` (TEXT).
FieldType = Literal["text", "real", "int", "bool"]

#: The UI editor to render for an editable field.
FieldEditor = Literal["text", "textarea", "select", "number", "bool"]

#: `gear.kind`; enforced on every write in `edits/gear.py`.
GearKind = Literal["shoe", "bike", "strap", "other"]

#: A scalar as it can appear in an edit or a raw column value.
Scalar = str | float | int | None


class _Model(BaseModel):
    # Attribute docstrings become field descriptions in the OpenAPI schema, so the
    # units and caveats below reach the generated frontend types too.
    model_config = ConfigDict(use_attribute_docstrings=True)


# ---------------------------------------------------------------------------
# Activities
# ---------------------------------------------------------------------------


class ActivityRow(_Model):
    """One row of `v_activities`: Garmin's values with the user's edits applied.

    Columns in view order: every column of `activities`, then the user-only edit
    fields, then the convenience columns the view derives.
    """

    activity_id: str
    day: str
    """Local date of the start, YYYY-MM-DD."""
    start_time_local: str
    start_time_utc: str | None
    """ISO-8601 UTC with a trailing Z, when the source supplied it."""
    activity_type: str
    """Open vocabulary; see `fields.ACTIVITY_TYPES` for the common values."""
    activity_name: str | None
    distance_m: float | None
    duration_s: float | None
    """Elapsed time."""
    moving_time_s: float | None
    avg_hr: float | None
    max_hr: float | None
    avg_speed_mps: float | None
    max_speed_mps: float | None
    elevation_gain_m: float | None
    calories: float | None
    avg_cadence_spm: float | None
    """Steps/min for runs, rpm for rides."""
    avg_power_w: float | None
    training_effect_aerobic: float | None
    training_effect_anaerobic: float | None
    trimp: float | None
    """Banister TRIMP, computed at normalise time."""
    raw_id: int | None
    """`raw_documents.id` of the payload this row was normalised from."""
    # User-only edit fields (live only in `overrides`).
    notes: str | None
    rpe: int | None
    """Perceived effort, 1..10."""
    private: int | None
    """0/1 flag, or null when never set."""
    excluded_from_stats: int | None
    """0/1 flag, or null when never set. Excluded activities leave every aggregate."""
    # Derived convenience columns.
    override_count: int
    """How many fields on this activity carry a user edit."""
    gear_ids: str | None
    """Comma-separated `gear_id`s on this activity (SQLite `group_concat`), or null
    when none. Order is not guaranteed."""
    route_id: int | None


class ActivityList(_Model):
    """A page of activities, plus every activity type present (most common first)."""

    total: int
    limit: int
    offset: int
    types: list[str]
    rows: list[ActivityRow]


class HrZone(_Model):
    zone: int
    seconds: float


class BestEffort(_Model):
    """Fastest window for a standard distance within this activity."""

    distance_m: float
    seconds: float
    label: str | None
    """Standard label ("1 k", "5 k", "HM", ...), or null for any other distance."""


class KmSplit(_Model):
    km: int
    """1-based kilometre number."""
    seconds: float
    avg_hr: float | None


class ActivityGear(_Model):
    """A `gear` row as attached to one activity, plus how it came to be attached."""

    gear_id: int
    kind: GearKind
    brand: str | None
    model: str | None
    nickname: str | None
    purchase_date: str | None
    """ISO date."""
    initial_distance_m: float
    """Mileage already on the item before it was tracked here."""
    retirement_distance_m: float | None
    """Warn/retire threshold; null means no limit."""
    retired: int
    """0/1 flag."""
    notes: str | None
    photo_path: str | None
    source: str
    """Where the gear record came from: 'manual' or 'garmin'."""
    garmin_uuid: str | None
    created_at: str
    updated_at: str
    assign_source: str
    """Who attached it to this activity: 'manual', 'garmin' or 'default_rule'."""
    assigned_at: str
    display_name: str
    """Nickname if set, else brand + model."""


class Override(_Model):
    """One user edit on an activity, with the Garmin value it is masking."""

    field: str
    value: str | None
    """Stored as TEXT; cast per `value_type`."""
    value_type: FieldType
    garmin_value_at_edit: str | None
    """What Garmin said when the edit was first made (TEXT); null for user-only."""
    created_at: str
    updated_at: str
    label: str
    current_garmin_value: Scalar
    """What Garmin says now, null for user-only fields."""
    revertible: bool


class RouteAssignment(_Model):
    """The route an activity has been filed under."""

    route_id: int
    match_score: float | None
    """0..1 path overlap at assignment time; null for a manual move."""
    assigned: Literal["auto", "manual"]
    name: str


class ActivityDetail(_Model):
    activity: ActivityRow
    hr_zones: list[HrZone]
    best_efforts: list[BestEffort]
    decoupling_pct: float | None
    """Percent speed:HR drift, second half vs first (positive = decoupled); null
    without samples carrying usable HR and distance."""
    efficiency_factor: float | None
    """Metres per minute per bpm, from the activity averages; null when the
    activity has no samples, no moving time or no average HR."""
    km_splits: list[KmSplit]
    gear: list[ActivityGear]
    overrides: list[Override]
    route: RouteAssignment | None
    has_gps: bool
    """True when any sample carries a latitude."""


class ActivityStreams(_Model):
    """The full sample stream, columnar: index i of every list is the same sample.

    Ordered by `elapsed_s`. Every list has `sample_count` entries. `lat`/`lon` are
    null wherever there is no position (indoor activities have none at all).
    """

    activity_id: str
    sample_count: int
    elapsed_s: list[float]
    distance_m: list[float | None]
    hr: list[float | None]
    speed_mps: list[float | None]
    cadence_spm: list[float | None]
    altitude_m: list[float | None]
    lat: list[float | None]
    lon: list[float | None]


# ---------------------------------------------------------------------------
# Editing
# ---------------------------------------------------------------------------


#: PATCH body: field name -> new value. The set of fields is config-driven
#: (`GET /api/fields`), so this stays a map. null or "" reverts a field.
ActivityEditPayload = dict[str, str | float | int | bool | None]


class AppliedEdit(_Model):
    """An edit that was stored."""

    activity_id: str
    field: str
    value: str | float | int
    """The coerced value (bool fields come back as 0/1)."""
    value_type: FieldType
    garmin_value: Scalar
    """Garmin's current value for the field; null for user-only fields."""
    updated_at: str
    reverted: Literal[False]


class RevertedEdit(_Model):
    """An edit whose value was null/empty, which reverts the field instead."""

    activity_id: str
    field: str
    value: None
    reverted: Literal[True]


class ActivityEditResult(_Model):
    activity: ActivityRow | None
    """Null only when the body was empty and the activity does not exist."""
    applied: list[AppliedEdit | RevertedEdit]
    overrides: list[Override]


class EditableFieldInfo(_Model):
    """One entry of the editable-field registry (`db/fields.py`)."""

    name: str
    type: FieldType
    label: str
    editor: FieldEditor
    choices: list[str] | None
    """For `select`: the offered values. Not always a closed set (activity_type)."""
    min: float | None
    max: float | None
    user_only: bool
    """True for fields Garmin never supplies (they live only in `overrides`)."""
    help: str


class FieldsResponse(_Model):
    fields: list[EditableFieldInfo]
    activity_types: list[str]
