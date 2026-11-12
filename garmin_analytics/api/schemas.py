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

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

#: How an editable field's value is cast back out of `overrides.value` (TEXT).
FieldType = Literal["text", "real", "int", "bool"]

#: The UI editor to render for an editable field.
FieldEditor = Literal["text", "textarea", "select", "number", "bool"]

#: What shape a route is (`analytics/routes.route_layout`): round a loop, out to a
#: turn and back the same way, or from one place to another.
RouteLayout = Literal["loop", "out_and_back", "one_way"]

#: `gear.kind`; enforced on every write in `edits/gear.py`.
GearKind = Literal["shoe", "bike", "strap", "other"]

#: A scalar as it can appear in an edit or a raw column value.
Scalar = str | float | int | None

#: A JSON number that may come out as an int or a float, and must keep which one it
#: was. Pydantic turns an int into a float for a plain `float` field, which would
#: change `1000` into `1000.0` on the wire.
Number = int | float


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
    fields, then the convenience columns the view derives. Last come the gym totals,
    which are not in the view: they are read from the raw payload (`api/gym.py`).
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
    race: int
    """0/1, resolved at the response boundary: the user's flag if they set one, else
    Garmin's `eventType` in the raw payload, else 0. Garmin tagged 1 of ~487
    activities as a race, so this is mostly the user's to set (see `api/gym.py`)."""
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
    # Gym totals from the raw payload; null for activities without exercise data.
    total_sets: int | None
    total_reps: int | None


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


class Lap(_Model):
    """One of the watch's laps. In a structured workout, one workout step."""

    lap_index: int
    """1-based, as the watch numbers them."""
    start_offset_s: float | None
    """Where the lap starts in the activity's elapsed time (the streams' `elapsed_s`)."""
    duration_s: float | None
    distance_m: float | None
    intensity: str | None
    """Garmin's step intensity: WARMUP, ACTIVE, REST, RECOVERY, COOLDOWN or INTERVAL.
    Null for a manual or auto lap, which is not part of a workout."""
    wkt_step_index: int | None
    avg_hr: float | None
    max_hr: float | None
    avg_speed_mps: float | None
    avg_cadence_spm: float | None
    """Steps per minute."""
    elevation_gain_m: float | None


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
    laps: list[Lap]
    """The watch's laps in order; empty when none were fetched."""
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


class Exercise(_Model):
    """One entry of Garmin's `summarizedExerciseSets`: an exercise summed over its
    sets. There is no per-set detail (weight and reps of each set)."""

    index: int
    """Position in the payload's `summarizedExerciseSets`; stable, so relabels key on it."""
    category: str | None
    """Garmin's exercise category (`BENCH_PRESS`, `DEADLIFT`, ...). `UNKNOWN` when the
    watch could not tell."""
    sub_category: str | None
    """The specific variant (`ROMANIAN_DEADLIFT`), when Garmin names one."""
    sets: int | None
    reps: int | None
    """Summed over all sets."""
    max_weight_g: Number | None
    """Heaviest weight used, grams; null for bodyweight exercises."""
    volume_g: Number | None
    """Sum of weight x reps over the sets, grams."""
    duration_ms: float | None
    """Summed duration of the exercise's sets, milliseconds."""
    edited: bool
    """True when the user relabelled this exercise; `category` is then theirs."""
    garmin_category: str | None
    """What Garmin called it, whatever the user relabelled it to. A revert
    (`DELETE /api/activities/{id}/exercises/{index}`) brings this back."""
    garmin_sub_category: str | None


class ActivityExercises(_Model):
    """`GET /api/activities/{id}/exercises`: the gym part of the raw payload, with the
    user's relabels applied. Totals are null and `exercises` is empty for activities
    without exercise data."""

    total_sets: int | None
    active_sets: int | None
    """Garmin's `activeSets`, passed through."""
    total_reps: int | None
    exercises: list[Exercise]


class ActivityListRow(ActivityRow):
    """One row of the activity list: `ActivityRow` plus what the list's card draws next
    to its numbers. Only the list sends these; the detail endpoint has its own."""

    has_gps: bool
    """True when the activity has a route to draw. The route itself comes from
    `GET /api/activities/previews`, so the list does not wait for it."""
    hr_zones: list[HrZone]
    """Seconds in each HR zone, by zone; empty when the activity has none."""
    exercises: list[Exercise]
    """A gym session's exercises, relabels applied; empty for anything else."""


class ActivityPreviews(_Model):
    """`GET /api/activities/previews`: each asked-for activity's route for its card."""

    polylines: dict[str, str]
    """Activity id -> the GPS track as Google encoded polylines (precision 5), simplified
    to at most 150 points in all for a small static map. A track that crossed a recording
    gap (the watch paused and resumed somewhere else) comes as its recorded pieces joined
    by `;`, so no line is drawn across the gap. Activities without GPS, or unknown, are
    absent."""


class GapPoint(_Model):
    elapsed_s: float
    lat: float
    lon: float


class GapEstimate(_Model):
    """A guess at the path ridden across a recording gap, taken from the rider's own other
    activities of the same type that passed near both ends. Not recorded, so never counted
    in the activity's totals, and always shown as an estimate."""

    lat: list[float]
    lon: list[float]
    """The path, simplified, from the last recorded point before the gap to the first after."""
    length_m: float
    avg_speed_mps: float
    """Length over the time the gap took: an average, and nothing about the pace inside it."""
    source_activity_id: str
    source_day: str | None
    source_name: str | None


class ActivityGap(_Model):
    """A stretch where the watch paused and resumed somewhere else."""

    before: GapPoint
    after: GapPoint
    seconds: float
    """Time that passed across the gap."""
    straight_m: float
    """Straight-line distance between the two ends."""
    estimate: GapEstimate | None
    """Null when nothing else in the rider's history passed both ends."""


class ActivityGaps(_Model):
    """`GET /api/activities/{id}/gaps`: the recording gaps of one activity, in order."""

    activity_id: str
    gaps: list[ActivityGap]


class ExerciseLastTime(_Model):
    """One earlier performance of an exercise. Units as Garmin sends them: grams."""

    activity_id: str
    day: str
    sets: int | None
    reps: int | None
    max_weight_g: float | None
    volume_g: float | None


class ExerciseHistoryEntry(_Model):
    index: int
    """The exercise's position in this session, as `/exercises` numbers it."""
    last: ExerciseLastTime | None
    """The most recent earlier session with the same exercise. Null for a first time, and
    for one Garmin could not name: name it and it has a history."""


class PreviousGymSession(_Model):
    activity_id: str
    day: str
    volume_g: float | None
    """Total volume across its exercises, in grams x reps."""
    sets: int | None


class ExerciseHistory(_Model):
    """`GET /api/activities/{id}/exercise-history`: what each exercise was last time."""

    activity_id: str
    previous: PreviousGymSession | None
    """The gym session before this one, for a total to compare against."""
    exercises: list[ExerciseHistoryEntry]


class ActivityList(_Model):
    """A page of activities, plus every activity type present (most common first)."""

    total: int
    limit: int
    offset: int
    types: list[str]
    rows: list[ActivityListRow]


class ExerciseRelabelRequest(_Model):
    """`PUT /api/activities/{id}/exercises/{index}` body: what the exercise really was.

    Garmin's own vocabulary (`BENCH_PRESS`, `ROMANIAN_DEADLIFT`), not free text, so the
    relabel maps to muscles like any other exercise. The set of names is not validated
    against a fixed list — Garmin adds exercises every year, and a correction the
    server refuses is one the user cannot make — but the shape is.
    """

    category: str
    sub_category: str | None = None


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


class RevertFieldResult(_Model):
    """`DELETE /api/activities/{id}/overrides/{field}`: one field back to Garmin's value."""

    reverted: bool
    """False when the field had no edit to revert."""
    activity: ActivityRow | None
    """Null when the activity does not exist."""
    overrides: list[Override]
    """The edits still on the activity."""


class RevertAllResult(_Model):
    """`DELETE /api/activities/{id}/overrides`: every field back to Garmin's value."""

    reverted: int
    """How many edits were dropped."""
    activity: ActivityRow | None


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


# ---------------------------------------------------------------------------
# Gear
# ---------------------------------------------------------------------------


#: `edits/gear.py` `_with_mileage`: how close the item is to its retirement distance.
GearState = Literal["ok", "warn", "over", "retired"]


class GearItem(_Model):
    """A `gear` row with the mileage put on it, for the gear list and the selects.

    Distances are metres unless the name says otherwise; `total_distance_m` includes
    `initial_distance_m`, the mileage the item already had before it was tracked here.
    """

    gear_id: int
    kind: GearKind
    brand: str | None
    model: str | None
    nickname: str | None
    purchase_date: str | None
    """ISO date."""
    initial_distance_m: float
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
    display_name: str
    """Nickname if set, else brand + model."""
    activity_count: int
    """Activities carrying this gear, excluded-from-stats ones left out."""
    tracked_distance_m: float
    """Distance of those activities, without `initial_distance_m`."""
    total_distance_m: float
    total_distance_km: float
    moving_time_s: float
    elevation_gain_m: float
    first_use: str | None
    """Local day of the earliest activity carrying it; null when unused."""
    last_use: str | None
    retirement_pct: float | None
    """`total_distance_m` as a percentage of the threshold; null without one."""
    remaining_m: float | None
    state: GearState
    distance_per_week_km: float | None
    """Tracked distance spread over first use to last use; null when unused."""


class GearDefaultRule(_Model):
    """A `gear_defaults` row: the gear newly-synced activities of a type get."""

    activity_type: str
    gear_id: int
    kind: GearKind
    brand: str | None
    model: str | None
    nickname: str | None
    display_name: str


class GearList(_Model):
    """`GET /api/gear`: every item, the default rules, and the kinds that exist."""

    gear: list[GearItem]
    defaults: list[GearDefaultRule]
    kinds: list[GearKind]


class GearActivityRow(_Model):
    """One activity on a gear item's page. Fewer columns than `ActivityRow`: this
    list answers "what has it been worn for", not "what happened that day"."""

    activity_id: str
    day: str
    activity_name: str | None
    activity_type: str
    distance_m: float | None
    moving_time_s: float | None


class GearDetail(_Model):
    """`GET /api/gear/{id}`: the item, and the 500 most recent activities on it."""

    gear: GearItem
    activities: list[GearActivityRow]


class GearWriteRequest(_Model):
    """`PATCH /api/gear/{id}` body, and the shared half of `POST /api/gear`.

    Every field is optional so a PATCH can send one; `create` refuses a body with no
    nickname, brand or model. A null a caller sends is a *clear*, not an omission:
    the handler passes `exclude_unset`, so `{"notes": null}` empties the notes and a
    field left out is untouched.
    """

    model_config = ConfigDict(extra="forbid")

    kind: GearKind | None = None
    brand: str | None = None
    model: str | None = None
    nickname: str | None = None
    purchase_date: str | None = None
    initial_distance_m: float | None = Field(None, ge=0)
    """Mileage the item already had before it was tracked here."""
    retirement_distance_m: float | None = Field(None, ge=0)
    retired: bool | None = None
    notes: str | None = None
    photo_path: str | None = None


class GearCreateRequest(GearWriteRequest):
    """`POST /api/gear` body: everything editable, plus the two provenance fields
    that can only be set when the item is made. An item imported from Garmin does
    not become a manual one by being edited, so `PATCH` does not take them."""

    source: str | None = None
    garmin_uuid: str | None = None
    """Unique; posting an item Garmin already supplied is a 400, not a duplicate."""


class GearDeleted(_Model):
    deleted: bool
    """False when there was no such item."""


class GearBulkAssignRequest(_Model):
    """`POST /api/gear/{id}/bulk-assign` body: which activities to put it on.

    An empty body means every activity ever, which is almost never meant, so the UI
    always sends a filter. `dry_run` answers with the count and changes nothing.
    """

    model_config = ConfigDict(extra="forbid")

    start: str | None = None
    end: str | None = None
    activity_type: str | None = None
    only_unassigned: bool = False
    """Skip activities that already carry gear of this item's kind."""
    dry_run: bool = False


class GearBulkAssignFilters(_Model):
    start: str | None
    end: str | None
    activity_type: str | None
    only_unassigned: bool


class GearBulkAssignResult(_Model):
    """What a bulk assign did, or would have done. On a dry run `applied` is 0 and
    `gear` and `filters` are absent, because nothing was applied."""

    gear_id: int
    matched: int
    applied: int
    dry_run: bool
    gear: str | None = None
    """The item's display name; absent on a dry run."""
    filters: GearBulkAssignFilters | None = None


class GearDefaultRequest(_Model):
    """`POST /api/gear/defaults` body."""

    model_config = ConfigDict(extra="forbid")

    activity_type: str
    gear_id: int


class GearDefaultsResult(_Model):
    """Every default rule after the change, not only the one just set: one default
    per (activity_type, kind), so setting one can displace another."""

    activity_type: str
    defaults: list[GearDefaultRule]


class GearDefaultCleared(_Model):
    cleared: bool


class ActivityGearRemoved(_Model):
    removed: bool


class ActivityGearRequest(_Model):
    """`PUT /api/activities/{id}/gear` body.

    `gear_ids` replaces the activity's whole gear set. `gear_id` attaches one item and
    replaces whatever gear of the *same kind* was there, which is what a per-kind
    select means: new shoes swap the old shoes and leave the HR strap alone. Send one
    or the other; `gear_ids` wins if both are present.
    """

    gear_ids: list[int] | None = None
    gear_id: int | None = None


class ActivityGearResult(_Model):
    """The activity's gear after the change."""

    activity_id: str
    gear: list[ActivityGear]


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


class RouteSummary(_Model):
    """One clustered route with its attempt count and headline stats.

    The per-attempt times come from `v_activities_included`, so activities the user
    excluded from stats do not set the best time. They are null for a route whose
    attempts have no moving time (or, after a split, none at all).
    """

    route_id: int
    name: str
    activity_type: str
    distance_m: float
    is_loop: bool
    """Starts and ends in the same place: a loop or an out-and-back."""
    layout: RouteLayout
    pinned: bool
    """True once the user renamed, merged or split it: reclustering leaves it alone."""
    start_lat: float
    start_lon: float
    centroid_lat: float
    centroid_lon: float
    elevation_gain_m: float | None
    created_at: str
    updated_at: str
    attempts: int
    first_day: str | None
    last_day: str | None
    avg_moving_time_s: float | None
    best_moving_time_s: float | None
    median_moving_time_s: float | None
    best_lap_s: float | None
    """For a loop: the fastest lap round it, over the attempts that count; null for a
    route that is not a loop, or one with no full lap timed."""
    median_lap_s: float | None
    """Typical time on this route. SQLite has no median aggregate, so it is taken at
    the response boundary over the same attempts the other times come from."""
    avg_hr: float | None
    distance_km: float
    polyline: str | None = None
    """The route's shape as a Google encoded polyline (precision 5), for the list's
    thumbnail. Null for a route with fewer than two points. Sent with the list rather
    than fetched per card as an activity's is: there are tens of routes, not thousands."""


class RouteList(_Model):
    routes: list[RouteSummary]


class Polyline(_Model):
    """A path, columnar: index i of `lat` and `lon` is the same point, and the two
    lists are the same length.

    Columnar rather than `[lat, lon]` pairs for the reason `/api/heatmap` is: a tuple
    does not survive into the frontend's generated types, and two arrays of numbers
    cost less JSON than an array of two-element arrays.
    """

    lat: list[float]
    lon: list[float]


class RoutePolyline(Polyline):
    """The route's representative polyline: `Polyline`, plus what the elevation
    profile and the segment boundaries are measured against."""

    altitude_m: list[float | None]
    """All null for a route whose attempts carried no altitude."""
    distance_m: list[float]
    """Cumulative metres from the start of the route."""


class Route(_Model):
    """One clustered route's own record: the geometry, not the attempts.

    `signature` (the clusterer's internal match key) is deliberately not serialised.
    """

    route_id: int
    name: str
    activity_type: str
    distance_m: float
    distance_km: float
    elevation_gain_m: float | None
    is_loop: bool
    """Starts and ends in the same place: a loop or an out-and-back."""
    layout: RouteLayout
    pinned: bool
    """True once the user renamed, merged or split it: reclustering leaves it alone."""
    start_lat: float
    start_lon: float
    end_lat: float
    end_lon: float
    centroid_lat: float
    centroid_lon: float
    created_at: str
    updated_at: str
    points: RoutePolyline


class RouteAttempt(_Model):
    """One activity filed on a route. Values are the user's edits where they made any."""

    activity_id: str
    day: str
    start_time_local: str | None
    activity_name: str | None
    distance_m: float | None
    moving_time_s: float | None
    duration_s: float | None
    avg_hr: float | None
    max_hr: float | None
    avg_speed_mps: float | None
    elevation_gain_m: float | None
    avg_cadence_spm: float | None
    rpe: Number | None
    excluded_from_stats: int | None
    """1 when the user excluded it; `stats` below then leaves it out. Null is
    "not excluded": it is a user-only field, unset until someone sets it."""
    match_score: float | None
    """How well the clusterer matched the track, 0-1; null once filed by hand."""
    assigned: Literal["auto", "manual"]
    laps: int | None
    """Full laps timed in this attempt, on a loop; null on a route that is not one."""
    lap_times_s: list[float]
    """Each timed lap, in order, start line to start line; empty when none."""
    best_lap_s: float | None


class RouteStats(_Model):
    """Headline numbers over the attempts that count (excluded ones are left out)."""

    best_time_s: float | None
    worst_time_s: float | None
    median_time_s: float | None
    avg_pace_s_per_km: float | None
    best_pace_s_per_km: float | None
    improvement_s: float | None
    """First counted attempt's time minus the last one's: positive means faster now.
    Null with fewer than two timed attempts."""
    first_day: str | None
    last_day: str | None
    lap_m: float | None
    """One lap of the route, for a loop; null otherwise. Lap times are over this."""
    laps: int
    """Laps timed over every counted attempt."""
    best_lap_s: float | None
    """The fastest lap ever round the loop, and the attempt it was in."""
    best_lap_activity_id: str | None
    best_lap_day: str | None
    median_lap_s: float | None


class RouteDetail(_Model):
    """`GET /api/routes/{id}`: the geometry, every attempt, and the trend across them."""

    route: Route
    attempts: list[RouteAttempt]
    attempt_count: int
    counted_count: int
    """Attempts not excluded from stats: the ones `stats` is computed over."""
    stats: RouteStats
    best_attempt: RouteAttempt | None
    worst_attempt: RouteAttempt | None


class RouteSegmentProfile(_Model):
    """One fixed-length stretch of a route, aggregated over every attempt at it."""

    seg_index: int
    start_m: float
    end_m: float
    attempts: int
    median_speed_mps: float | None
    median_pace_s_per_km: float | None
    fastest_speed_mps: float | None
    slowest_speed_mps: float | None
    speed_cv_pct: float | None
    """Coefficient of variation across attempts, %: how consistent this stretch is."""
    relative_speed: float | None
    """Median of (this stretch's speed / that attempt's own average speed). Below 1
    is ground you are consistently slower on, whichever day you ran it."""
    median_hr: float | None
    median_cadence_spm: float | None
    median_gradient_pct: float | None
    median_seconds: float | None
    path: Polyline
    """The slice of the route's polyline this stretch covers; empty when the polyline
    does not resolve two points inside it."""


class RouteSegments(_Model):
    """`GET /api/routes/{id}/segments`: where you speed up and where you slow down.

    A route with no computed efforts (every attempt too short, or a fresh split)
    comes back with `segments` empty, `segment_m` null and no name.
    """

    route_id: int
    name: str | None = None
    segment_m: float | None
    """The stretch length every segment shares, metres."""
    attempts: int
    segments: list[RouteSegmentProfile]
    fastest_segments: list[RouteSegmentProfile] = Field(default_factory=list)
    """The three stretches with the highest `relative_speed`, fastest first."""
    slowest_segments: list[RouteSegmentProfile] = Field(default_factory=list)


class RouteSimilar(_Model):
    """One route this one could be merged with, and how alike they are."""

    route_id: int
    similarity: float
    """Shared ground, 0..1: `match_score` both ways round, the lower. The clusterer's
    own measure (D16), so this and the grouping agree about what one route is.
    Usually 0 — anything above the clusterer's threshold is already the same route."""
    metres_away: float
    """Between the two centroids. What ranks the candidates once the scores tie, which
    with a well-clustered database is most of them."""


class RouteSimilarList(_Model):
    """Candidates for a merge, most alike first, then nearest."""

    candidates: list[RouteSimilar]


class RouteRenameRequest(_Model):
    """`PATCH /api/routes/{id}` body."""

    name: str


class RouteRenameResult(_Model):
    route_id: int
    name: str
    pinned: Literal[True]
    """Naming a route pins it: the clusterer stops second-guessing it."""


class RouteMergeRequest(_Model):
    """`POST /api/routes/{id}/merge` body: the routes to fold into this one."""

    route_ids: list[int]


class RouteMergeResult(_Model):
    route_id: int
    """The route that survived; the others are gone."""
    merged: list[int]
    moved_activities: int


class RouteSplitRequest(_Model):
    """`POST /api/routes/{id}/split` body: the attempts to pull out into a new route."""

    activity_ids: list[str]
    name: str | None = None
    """The new route's name; "<old name> (split)" when not given."""


class RouteSplitResult(_Model):
    route_id: int
    """The new route."""
    from_route_id: int
    moved: int


class RouteDeleteResult(_Model):
    deleted: bool
    """False when there was no such route. Either way its activities are only
    unclustered, never deleted."""


class ReclusterRequest(_Model):
    """`POST /api/routes/recluster` body. Routes the user pinned are left alone."""

    threshold: float | None = None
    """How similar two tracks must be to count as the same route, 0-1; the
    clusterer's own default when not given."""
    fresh: bool = False
    """Rebuild the routes from the tracks: every route nobody has renamed, merged,
    split or filed an activity on by hand is removed first."""


class CompareActivity(_Model):
    """The headline numbers shown beside a compared track."""

    activity_id: str
    day: str
    activity_type: str
    """Added at the response boundary: the compare view needs the sport to know
    whether a pace reads in /km or km/h."""
    activity_name: str | None
    distance_m: float | None
    moving_time_s: float | None
    avg_hr: float | None
    avg_speed_mps: float | None
    elevation_gain_m: float | None


class CompareAttempt(_Model):
    activity: CompareActivity
    streams: ActivityStreams
    """The samples that carry a position, columnar and named exactly as
    `/api/activities/{id}/streams` names them, so the browser adapts a compared
    activity the same way it adapts one on its own page. An indoor activity has none
    and compares as an empty track."""


class CompareTracks(_Model):
    """`GET /api/routes/compare/tracks`: two to five activities overlaid."""

    count: int
    attempts: list[CompareAttempt]


class ReclusterResult(_Model):
    """What a re-run of the clustering did, counted by what happened to each activity."""

    activities: int
    routes: int
    """How many routes exist afterwards."""
    created: int
    joined: int
    no_gps: int
    too_short: int
    kept_manual: int
    already_filed: int = 0
    """Already on a route and left there (every activity, on a `fresh` rebuild, is
    filed again instead)."""


class ActivityRouteRequest(_Model):
    """`PUT /api/activities/{id}/route` body: the route to refile the activity onto."""

    route_id: int


class ActivityRouteResult(_Model):
    activity_id: str
    route_id: int
    assigned: Literal["manual"]
    """A move by hand is always manual, never a match score."""


class Heatmap(_Model):
    """`GET /api/heatmap`: every recorded GPS point, snapped to a grid and counted.

    Columnar, like `/streams`: index i of `lat`, `lon` and `count` is the same cell,
    and every list has `cells` entries. Densest cell first.

    The aggregation is server-side because the browser cannot usefully draw millions
    of raw points; the grid is capped, so a query that hits the cap returns the
    busiest part of it rather than all of it.
    """

    precision: int
    """Decimal places the coordinates were rounded to: the grid's fineness."""
    cells: int
    """How many grid cells each column holds."""
    max_count: int
    """The densest cell's count; 0 when there are no points at all."""
    lat: list[float]
    lon: list[float]
    count: list[int]
    """Samples recorded in the cell."""


# ---------------------------------------------------------------------------
# Status: summary, training load, readiness, race, health, Garmin and sync
# ---------------------------------------------------------------------------
#
# Some of these handlers leave keys out in some states (an empty database, a sync
# cursor that only ever holds the keys of the phase that wrote it). Fields for those
# keys have a default and their routes use `response_model_exclude_unset`, so an
# absent key stays absent instead of turning into an explicit null. In OpenAPI they
# are simply not `required`.

#: `trends.TREND_METRICS`: every metric `compute_trends` scores by default.
TrendMetric = Literal[
    "resting_hr", "hrv", "sleep_score", "total_sleep_s", "bb_high", "stress_avg", "steps"
]

#: `readiness.readiness_band`.
ReadinessBand = Literal["prime", "ready", "moderate", "low", "rest"]

#: `load.form_label`: the plain-English reading of TSB.
FormLabel = Literal[
    "very fresh (detraining risk)", "fresh", "neutral", "fatigued (productive)",
    "very fatigued",
]

#: `backfill.PHASES`, in run order.
SyncPhase = Literal["activities", "details", "wellness", "derive"]

#: `sync_status.state`, as written by `ingest/backfill.py` ("idle" before any run).
SyncState = Literal["idle", "running", "done", "cancelled", "error"]


class DayRange(_Model):
    """First and last day of `daily_wellness`; both null on an empty database."""

    from_: str | None = Field(alias="from")
    to: str | None


class DailyRow(_Model):
    """One row of `v_daily`: the per-day wellness picture, joined across tables."""

    day: str
    resting_hr: float | None
    steps: int | None
    stress_avg: float | None
    bb_high: int | None
    """Body Battery, 0..100."""
    bb_low: int | None
    bb_charged: int | None
    bb_drained: int | None
    total_sleep_s: float | None
    sleep_score: float | None
    deep_s: float | None
    rem_s: float | None
    hrv: float | None
    """Last night's average HRV, ms."""
    hrv_status: str | None
    """Garmin's own label (BALANCED, UNBALANCED, LOW, POOR, ...), passed through."""
    vo2max_run: float | None
    training_status: str | None
    """Garmin's own label (PRODUCTIVE, MAINTAINING, ...), passed through."""
    training_readiness: int | None
    """Garmin's training-readiness score, 0..100."""
    weight_kg: float | None


class DailySleepRow(DailyRow):
    """A `/api/daily` row: `v_daily`, plus the sleep stage the view leaves out.

    The view carries deep and REM but not light, and a sleep-stage chart needs all
    three. It is read from `sleep` at the response boundary rather than by widening
    the view, which the trend engine also reads.
    """

    light_s: float | None


class DailyList(_Model):
    """`GET /api/daily`: the last `days` days on record, oldest first."""

    days: int
    """How many rows came back: the window asked for, or all there are."""
    rows: list[DailySleepRow]


class TrendFlag(_Model):
    """A recovery metric whose latest value is at least `z_threshold` sigma off its
    own trailing baseline."""

    metric: TrendMetric
    z: float
    verdict: Literal["better than baseline", "worse than baseline"]


#: `trends.series_trend`: how the latest value reads against its own baseline.
TrendVerdict = Literal[
    "insufficient data", "normal", "better than baseline", "worse than baseline"
]


class MetricTrend(_Model):
    """One metric's daily series, its rolling means, and today against its baseline.

    `values`, `roll7`, `roll28` and `roll90` are parallel to `days`, with a null on
    every day that has no reading. Units are as stored: bpm, ms, seconds, 0..100.
    """

    metric: TrendMetric
    days: list[str]
    values: list[float | None]
    roll7: list[float | None]
    """Trailing 7-day mean of the days that have a reading."""
    roll28: list[float | None]
    roll90: list[float | None]
    latest: float | None
    """The last day's value; null when that day has no reading."""
    baseline_mean: float | None
    baseline_sd: float | None
    z: float | None
    """Sigma from the trailing baseline, which excludes the day being scored; null
    when the baseline is too short or has no spread."""
    flagged: bool
    verdict: TrendVerdict


class Trends(_Model):
    """`GET /api/trends`. On an empty database `metrics` and `flags` are empty and
    the two constants behind them are absent."""

    metrics: dict[TrendMetric, MetricTrend]
    """Keyed by metric name; only the metrics asked for when `metrics=` is given."""
    flags: list[TrendFlag]
    baseline_days: int | None = None
    """Length of the trailing baseline each `z` is measured against."""
    z_threshold: float | None = None
    """|z| at or above which a metric is flagged."""


# --- Fitbit connection -----------------------------------------------------------------


class FitbitStatus(_Model):
    """`GET /api/fitbit/status`. Deliberately makes no network call: Fitbit allows 150
    requests an hour and a Settings page that asks it anything spends one per open."""

    connected: bool
    credentials_configured: bool
    """Whether GOOGLE_HEALTH_CLIENT_ID and GOOGLE_HEALTH_CLIENT_SECRET are in the
    environment. Until they are, there is nothing to connect *with* and the panel says
    so. The legacy FITBIT_* names are still accepted."""
    user_id: str
    """The Google Health user id of the connected account. Empty when not connected."""
    last_synced_day: str | None = None
    weigh_ins: int
    first_day: str | None = None
    last_day: str | None = None
    redirect_uri: str
    """What has to be an Authorized redirect URI on the Google Cloud OAuth client,
    character for character."""
    signin_expires_at: str | None = None
    """When Google ends this sign-in: 7 days after consent while the app is in Testing
    (D9). Null when not connected, or connected before this was recorded."""


class FitbitAuthorizeUrl(_Model):
    """The consent URL to open. The PKCE verifier behind it stays on the server."""

    url: str
    redirect_uri: str
    expires_in_s: int


class FitbitConnectRequest(_Model):
    """The address bar the browser landed on, or just the code out of it."""

    redirect: str


class FitbitConnected(FitbitStatus):
    status: str


class FitbitDisconnected(FitbitStatus):
    status: str
    removed_files: int


class FitbitSyncResult(_Model):
    """What a sync did. `state` is `done`, `rate_limited` or `stopped`."""

    endpoint: str
    start_day: str
    end_day: str
    days_written: int
    weight_points: int
    body_fat_points: int
    state: str
    retry_after_s: int | None = None
    """Seconds until Google's per-minute budget resets, when that is why it stopped."""
    last_day: str | None = None
    """The last day written, and the new watermark. Absent if the run never got that far."""


class FitbitImportRequest(_Model):
    """A path on the server to a Fitbit export ZIP from Google Takeout."""

    path: str


class FitbitImportResult(_Model):
    zip: str
    members_scanned: int
    written: int
    units_found: list[str]
    """`kg`, `lb`, or both — the export does not say, so it is inferred and reported."""
    unrecognised_count: int
    undecodable_count: int


# --- body composition ----------------------------------------------------------------


class BodySeries(_Model):
    """The weigh-in series on one dense daily axis.

    Every list is parallel to `days`, which has no holes in it — a sparse axis would
    close the gaps between weigh-ins and quietly claim the scale was used every day.
    `weight_kg` is null on a day with no reading; the three smoothed series carry the
    trend across, which is what they are for.
    """

    days: list[str]
    weight_kg: list[float | None]
    """The raw readings. Draw these faintly behind the trend, never as the series."""
    trend_kg: list[float | None]
    """Gap-aware exponential trend, 7-day half-life."""
    fat_kg: list[float | None]
    """Smoothed fat mass: weight × body fat %."""
    lean_kg: list[float | None]
    """Smoothed lean mass: the rest of it."""
    fat_pct: list[float | None] = []
    """Smoothed body fat percentage, as the scale reported it. Plotted directly by the
    History page rather than derived from the two rounded masses above."""


class BodyConsistency(_Model):
    """How often the scale was actually used over the window.

    Not housekeeping: every other number here is a function of how much data there is,
    and showing the gaps is the honest way to say a trend is thin.
    """

    readings: int
    span_days: int
    coverage_pct: float
    per_week: float
    longest_gap_days: int | None = None
    """Days *between* two readings, so consecutive mornings are a gap of 0."""
    days_since_last: int | None = None


class BodyLatest(_Model):
    """Where the athlete is now, and how far that has moved over the window drawn."""

    day: str
    trend_kg: float | None = None
    reading_kg: float | None = None
    """The most recent actual reading. A card showing this alone would be noise."""
    fat_kg: float | None = None
    lean_kg: float | None = None
    change_kg: float | None = None
    fat_change_kg: float | None = None
    lean_change_kg: float | None = None


class RaceWeightProjection(_Model):
    """The recent trend carried forward to race day.

    Null when there is not enough recent data to fit a line — under 8 readings or under
    28 days of trend in the window — rather than a projection from three points.

    **`rule_of_thumb_s_per_km` and `rule_of_thumb_race_s` are a rule of thumb, not a
    prediction.** They apply the commonly quoted ~2 s per mile per pound to the
    projected change. That figure is a rough empirical average across runners, it
    assumes the weight lost is fat rather than muscle, and it says nothing about this
    athlete in particular. Label it as such wherever it is shown.
    """

    race_name: str
    race_day: str
    days_out: int
    current_trend_kg: float
    projected_kg: float
    change_kg: float
    slope_kg_per_week: float
    window_days: int
    """Days of trend the line was fitted over."""
    readings_used: int
    rule_of_thumb_s_per_km: float
    rule_of_thumb_race_s: int


class WeightLoadPoint(_Model):
    """One day that has both a weight trend and a CTL."""

    day: str
    trend_kg: float
    ctl: float


class PowerToWeightPoint(_Model):
    """One ride's average watts over the weight trend on the day it was ridden.

    Divided by the trend rather than that morning's reading: hydration noise in the
    divisor would appear in the performance series as form.
    """

    day: str
    activity_id: str
    watts_per_kg: float


class SpeedWeightPoint(_Model):
    """One week's mean run speed and mean weight trend, each as a percentage of the
    first week in the window.

    Deliberately two indexed series rather than a speed-per-kilogram: running cost is
    already roughly proportional to bodyweight, so dividing again produces a number
    with no meaning. The comparison is the reader's to make.
    """

    week: str
    speed_index: float
    weight_index: float


class BodyComposition(_Model):
    """`GET /api/body`. `has_data` is false when nothing has ever been weighed, and
    everything else is empty rather than null-filled, so the UI hides the section
    instead of drawing an empty chart."""

    has_data: bool
    series: BodySeries
    consistency: BodyConsistency
    latest: BodyLatest | None = None
    projection: RaceWeightProjection | None = None
    against_load: list[WeightLoadPoint]
    power_to_weight: list[PowerToWeightPoint]
    speed_vs_weight: list[SpeedWeightPoint]


class ReadinessComponents(_Model):
    """Per-component sub-scores, 0..100, null when that component has no data.

    Every key is present once any wellness day exists; the object is empty `{}` on
    an empty database.
    """

    sleep: float | None = None
    hrv: float | None = None
    tsb: float | None = None
    rhr: float | None = None


class ReadinessWeights(_Model):
    """Component weights (sum 1.0). Components without data are dropped and the
    rest renormalised."""

    sleep: float
    hrv: float
    tsb: float
    rhr: float


class Readiness(_Model):
    """Today's composite readiness, with the reasoning behind it."""

    day: str | None
    """The day scored (latest in `v_daily` unless asked); null with no data."""
    score: float | None
    """0..100, null when no component has data."""
    band: ReadinessBand | None
    components: ReadinessComponents
    weights: ReadinessWeights
    reasons: list[str]
    """One sentence per component (sleep, HRV, TSB, resting HR), or ["No data."]."""
    recommendation: str
    """What to do today, in words."""
    garmin_training_readiness: int | None
    """Garmin's own score for the day, for comparison."""
    flags: list[TrendFlag]


class ReadinessPoint(_Model):
    day: str
    score: float | None
    band: ReadinessBand | None


class ReadinessHistory(_Model):
    days: int
    """The window asked for; `series` may be shorter."""
    series: list[ReadinessPoint]


class LoadDay(_Model):
    """One day of the dense CTL/ATL/TSB curve (rest days are zero-load rows)."""

    day: str
    load: float
    """That day's summed TRIMP."""
    ctl: float
    """Chronic training load, 42-day EWMA of TRIMP."""
    atl: float
    """Acute training load, 7-day EWMA of TRIMP."""
    tsb: float
    """Training stress balance, CTL - ATL (same day)."""


class LoadWeek(_Model):
    """The daily curve rolled up into an ISO week."""

    week: str
    """ISO week, `2026-W38`."""
    start: str
    """Monday of the week (or the first curve day, for a partial first week)."""
    load: float
    ctl_end: float
    atl_end: float
    tsb_end: float
    delta_pct: float | None
    """Load change vs the previous week, percent; null for the first week or after
    a zero-load week."""
    ctl_delta_pct: float | None
    """CTL change vs the previous week's end, percent."""
    overreaching: bool
    """True when `ctl_delta_pct` exceeds the 10 %/week ramp flag."""


class LoadCurrent(_Model):
    """The last day of the load curve."""

    day: str
    ctl: float
    atl: float
    tsb: float
    form: FormLabel


class TrainingLoad(_Model):
    """`GET /api/load`. With no activities: empty lists, and `current` and
    `ramp_pct` null; the warm-up keys and `ramp_flag` are then absent."""

    curve: list[LoadDay]
    weeks: list[LoadWeek]
    warmup_until: str | None = None
    """Before this day, CTL/ATL are a cold-start artefact of seeding at zero."""
    warmup_note: str | None = None
    current: LoadCurrent | None
    ramp_pct: float | None
    """Percent change in CTL over the last 7 days; null without enough history."""
    ramp_flag: bool | None = None
    """True when `ramp_pct` is above the 10 %/week flag."""


class RaceProjection(_Model):
    """Riegel projection to the race distance from the longest usable recent best."""

    from_distance_m: Number
    from_label: str
    """Label of the best it was projected from ("5 k", "10 k", ...)."""
    from_seconds: float
    """Time of that best effort."""
    from_day: str
    projected_seconds: float
    exponent: float
    """Riegel exponent used."""


class RaceInfo(_Model):
    """A race read from the training calendar: a session the parser marked
    `kind='race'`. Everything but the name and the day is optional, because a calendar
    entry need not carry a start time or a distance."""

    name: str
    date: str
    """ISO date."""
    start_local: str | None
    """Gun time, HH:MM local to `timezone`."""
    timezone: str
    """IANA zone name."""
    distance_m: float | None


class PersonalBest(_Model):
    """Fastest effort at a standard distance (running, treadmill or walking)."""

    distance_m: Number
    label: str
    seconds: float
    day: str
    activity_id: str


class RaceWeekKm(_Model):
    week: str
    """ISO week, `2026-W38`."""
    start: str
    """Monday of the week."""
    km: float
    """Running kilometres that week."""


class RaceNote(_Model):
    level: Literal["good", "warning"]
    text: str


class PlanTargets(_Model):
    """Derived from the plan, replacing the constants that were invented (D12).

    It lives up here, above the race panel that embeds it, rather than down in the
    training-plan section it otherwise belongs to.
    """

    peak_weekly_km: float | None
    """The plan's biggest prescribed running week."""
    mean_weekly_km: float | None = None
    source: Literal["plan", "none"]
    ctl_target: float | None = None
    """`peak_weekly_km` priced in `load_per_km`, divided over seven days: the CTL a
    week held at the plan's peak settles at. Null with no plan or no recent running."""
    load_per_km: float | None = None
    """TRIMP per kilometre from the owner's last 90 days of running — the thing that
    makes `ctl_target` derived rather than invented."""


class RacePanel(_Model):
    """`GET /api/race`: countdown, projection and the CTL / volume gap to target.

    Every target here is the plan's, and every one of them is null with no calendar
    subscribed — the panel then draws its curves without a goal line rather than
    inventing one (D12)."""

    race: RaceInfo | None
    """The race from the training calendar, or null when none is named ahead (T57).
    It used to be four constants in `config.py`, which went on counting down after the
    race was run."""
    today: str
    days_to_go: int | None
    """Negative once the race has passed."""
    weeks_to_go: float | None
    projection: RaceProjection | None
    """Null with no usable best effort."""
    ctl_now: float
    ctl_target: float | None
    """The plan's peak week priced in the owner's own load per km. Null with no plan,
    or with no recent running to price it from."""
    ctl_per_week_needed: float | None
    """Straight-line CTL gain per week to reach the target; null inside the last week,
    and null with no target."""
    tsb_now: float | None
    weekly_km: list[RaceWeekKm]
    """The last 26 weeks with any running."""
    weekly_km_avg_4wk: float
    """Running km/week over the 28 days ending on the last activity."""
    weekly_km_target: float | None
    """The plan's biggest prescribed week. Null with no plan."""
    targets: PlanTargets
    """Where the two targets above came from, so the panel can label them derived."""
    recent_bests: list[PersonalBest]
    """Bests from the last 120 days of activities."""
    notes: list[RaceNote]


class ForecastDay(_Model):
    """One day of the forward curve. The `_followed` values are the same curve with
    each remaining session done at the recent adherence; null when there is none."""

    day: str
    ctl: float
    atl: float
    tsb: float
    ctl_followed: float | None
    atl_followed: float | None
    tsb_followed: float | None


class ForecastMorning(ForecastDay):
    """The state at the start of race day, which is the end of the day before."""

    form: str
    """Plain-English reading of the form the verdict is judged on."""


class ForecastPeak(_Model):
    day: str
    ctl: float


class FormForecast(_Model):
    """Fitness, fatigue and form from today to race morning, under the plan."""

    race_day: str
    days_out: int
    load_per_km: float
    """TRIMP per running kilometre, from the last weeks of running."""
    km_done_pct: float | None
    """Running km done over km planned, last 28 days. It scales the "followed" curve; null
    when the plan asked for no running in that window."""
    planned_km_remaining: float
    curve: list[ForecastDay]
    race_morning: ForecastMorning
    peak: ForecastPeak
    basis: Literal["plan", "followed"]
    """Which scenario the verdict judges: followed when adherence is known."""
    verdict: RaceNote
    caveats: list[str]


class TimeSource(_Model):
    label: str | None
    distance_m: float
    seconds: float
    day: str
    projected_seconds: float
    """Riegel projection to the race distance, before any adjustment."""
    ctl_then: float | None
    fitness_factor: float
    adjusted_seconds: float


class TimeBand(_Model):
    fast: float
    central: float
    slow: float


class TimeRange(_Model):
    """A finish-time range from every recent effort of 5 km and up.

    `raw` is the data; `adjusted` adds two rules of thumb (fitness gained since the
    efforts, and race-morning form) which are not measurements and are shown apart."""

    distance_m: float
    raw: TimeBand
    adjusted: TimeBand
    central_pace_s_per_km: float
    fitness_pct: float
    """Percent change in time for fitness gained since the efforts; negative is faster."""
    form_pct: float
    ctl_race: float | None
    tsb_race: float | None
    basis: Literal["plan", "followed"] | None
    sources: list[TimeSource]
    widened: bool
    """True when the Riegel exponent band (1.04 to 1.08) on the longest effort reached
    past the spread between efforts, so the range is wider than the efforts alone."""
    caveats: list[str]


class LongRunNote(_Model):
    """The last long run, when it was missed or cut short, and what that costs on race day.
    Null when the last one in the past fortnight was done, or there was none."""

    day: str
    verdict: Literal["missed", "short"]
    planned_km: float
    done_km: float
    shortfall_km: float
    cost_seconds: float | None
    """Seconds on the finish, by the same rule of thumb as the fitness adjustment: rough,
    and usually small. Null without a forecast to price it against."""
    next_day: str | None
    next_km: float | None


class TaperWeek(_Model):
    start: str
    """The Monday."""
    planned_km: float
    """Prescribed running, without the race itself in race week."""
    pct_of_peak: int
    race_week: bool


class TaperCheck(_Model):
    """The plan's taper as written, and where it leaves form on race morning.

    This is the plan followed as prescribed, whatever has been run so far: it asks whether
    the taper is well made, not whether the training reaches it."""

    peak_km: float
    """The biggest full week before race week."""
    weeks: list[TaperWeek]
    """The last full weeks, then race week."""
    race_morning_tsb: float
    race_morning_ctl: float
    form: str
    verdict: RaceNote


class PacingPreset(_Model):
    label: str
    target_s: float


class PacingTurn(_Model):
    km: float
    """Kilometres from the start, on the race's own distance."""
    kind: Literal["turn", "turnaround"]


class PacingCourse(_Model):
    """What was known of the course. `none` when no GPX is in the data directory."""

    source: Literal["gpx", "none"]
    length_m: float | None
    turns: list[PacingTurn]


class PacingSplit(_Model):
    km: int
    distance_m: float
    """1000, except the last row, which is the partial kilometre to the finish."""
    split_s: float
    cum_s: float
    pace_s_per_km: float
    end_m: float


class RacePacing(_Model):
    """`GET /api/race/pacing`: per-kilometre splits for a target time, adding up to it.

    A gentle first kilometre and a few seconds for each turn are rules of thumb, and the
    plan is flat: there is no elevation in a course file. The splits are for the race's
    official distance."""

    race: RaceInfo | None
    target_s: float | None
    strategy: Literal["even", "negative"]
    presets: list[PacingPreset]
    """The finish range's fast, likely and slow ends, as targets to choose from."""
    course: PacingCourse
    splits: list[PacingSplit]


class RaceForecast(_Model):
    """`GET /api/race/forecast`. Each half is null when it cannot be computed."""

    race: RaceInfo | None
    today: str
    form: FormForecast | None
    time: TimeRange | None
    long_run: LongRunNote | None
    taper: TaperCheck | None


class SummaryRace(_Model):
    """The race countdown, cut down for the summary."""

    name: str
    date: str
    distance_m: float | None
    """A calendar race need not name a distance."""
    days_to_go: int
    projection: RaceProjection | None


class WeeklyReportRow(_Model):
    """One ISO week of activity and wellness totals (`reports.weekly_report`)."""

    week: str
    start: str
    sessions: int
    runs: int
    km: float
    """All sports."""
    run_km: float
    """Running only."""
    hours: float
    trimp: float
    elev_m: int
    avg_hr: float | None
    rhr: float | None
    hrv: float | None
    sleep_h: float | None
    sleep_score: float | None
    steps: int | None
    km_delta_pct: float | None
    """Running km change vs the previous week, percent."""
    trimp_delta_pct: float | None


class ReportTotals(_Model):
    activities: int
    active_days: int
    tracked_days: int
    """Days with any wellness data."""
    total_km: float
    total_run_km: float
    total_hours: float


class Streak(_Model):
    length: int
    start: str | None
    end: str | None


class Streaks(_Model):
    longest_active: Streak
    current_active: int
    """Consecutive active days ending on the last wellness day (or the day before)."""
    longest_wear: Streak


class GymThisWeek(_Model):
    """Gym work in the current ISO week (Monday to Sunday, by the activity's local
    day) against the mean of the four weeks before it. A gym session is an activity
    with exercise data (`total_sets`); excluded-from-stats activities do not count."""

    week_start: str
    """The Monday that starts this week."""
    sessions: int
    sets: int
    """`total_sets` summed over this week's sessions."""
    avg_sessions: float
    """Mean sessions per week over the four weeks before this one."""
    avg_sets: float
    sessions_delta_pct: float | None
    """This week against `avg_sessions`, percent; null when the average is zero."""
    sets_delta_pct: float | None


class Summary(_Model):
    """`GET /api/summary`: the overview in one round trip. Load keys are null with
    no activities."""

    day_range: DayRange
    synthetic: bool
    """True when the database holds seeded demo data, not a real account."""
    latest_day: DailyRow | None
    readiness: Readiness
    load: LoadCurrent | None
    ramp_pct: float | None
    ramp_flag: bool | None
    warmup_note: str | None
    flags: list[TrendFlag]
    """Recovery-metric deviations over the last 180 days."""
    totals: ReportTotals
    streaks: Streaks
    race: SummaryRace | None
    """The race from the training calendar, or null when none is named ahead (T57).
    It used to be four constants in `config.py`, which went on counting down after the
    race was run."""
    recent_weeks: list[WeeklyReportRow]
    """Up to the last eight weeks with activity."""
    gym: GymThisWeek | None
    """Null when there was no gym session in the last eight weeks (this one included)."""


# ---------------------------------------------------------------------------
# Performance: bests, decoupling, efficiency, VO2max
# ---------------------------------------------------------------------------


class DecouplingPoint(_Model):
    """One run long enough to drift (over `DECOUPLING_MIN_DURATION_S`).

    `distance_km` is not the app's usual `*_m`: it is what `analytics.performance`
    computes, and `analytics/` is not reshaped to suit the UI. The name carries the
    unit, so nothing has to guess.
    """

    activity_id: str
    day: str
    name: str | None
    """The activity's name; null when Garmin sent none."""
    distance_km: float
    duration_s: float | None
    """Moving time."""
    decoupling_pct: float | None
    """Percent drift in speed:HR from the first half to the second. Positive means
    the second half cost more heartbeats per metre. Null without usable HR."""
    efficiency_factor: float | None
    """Metres per minute per bpm over the whole run. Null without an average HR."""
    aerobically_durable: bool
    """True when `decoupling_pct` is at or under Friel's 5 %."""


class EfficiencyPoint(_Model):
    """`efficiency_factor` alone, for the runs that have one."""

    day: str
    ef: float


class Vo2maxPoint(_Model):
    day: str
    vo2max_run: float
    """Garmin's running VO2max estimate for the day, ml/kg/min."""


class Performance(_Model):
    """`GET /api/performance`.

    The bests come from `best_efforts`, restricted to foot-borne sports
    (`performance.BEST_EFFORT_TYPES`): a bike covers 5 km in nine minutes, so an
    unfiltered list is a list of rides labelled in min/km.
    """

    personal_bests: list[PersonalBest]
    """One per standard distance ever covered, fastest first effort at each."""
    recent_bests_90d: list[PersonalBest]
    """The same, over the 90 days ending on the last activity."""
    decoupling: list[DecouplingPoint]
    """Every qualifying run, oldest first."""
    decoupling_recent: list[DecouplingPoint]
    """The last twelve of `decoupling`."""
    vo2max: list[Vo2maxPoint]
    """Daily, oldest first; days Garmin had no estimate for are absent."""
    efficiency_trend: list[EfficiencyPoint]


# ---------------------------------------------------------------------------
# Aggregates: totals, periods, distributions, patterns, streaks, records
# ---------------------------------------------------------------------------
#
# Every block below reads `v_activities_included`, so user edits count and an
# excluded activity is invisible. `analytics/aggregate.py` renders some of its own
# numbers into strings (`avg_pace`, a best effort's `time`, an extreme's `display`,
# a histogram bucket's `label`); those are left out here, because the number behind
# each is in the same object and `format.ts` is the one place numbers become
# strings. Names that are not a rendered number — a distance's `label` ("1 k"), a
# weekday's `name` ("Mon"), an extreme's `label` ("Longest distance") — stay, as
# `PersonalBest.label` does.
#
# The `*_km` and `*_h` convenience fields do stay. `year_over_year` keys its
# `changes` on `distance_km`, `moving_time_h` and `avg_distance_km` by those exact
# names, so dropping them would leave a delta with no number beside it.


class PeriodTotals(_Model):
    """The totals every aggregate row carries, for whatever set of activities it
    covers: all of them, one sport, one year, one month, one week."""

    activities: int
    distance_m: float
    duration_s: float
    moving_time_s: float
    elevation_gain_m: float
    calories: float
    trimp: float
    avg_hr: float | None
    """Mean of the per-activity averages; null when none recorded heart rate."""
    avg_distance_m: float | None
    avg_moving_time_s: float | None
    first_day: str | None
    last_day: str | None
    distance_km: float
    duration_h: float
    moving_time_h: float
    avg_distance_km: float | None
    avg_speed_mps: float | None
    """Total distance over total moving time, not the mean of per-activity speeds:
    otherwise a 400 m stride would weigh as much as a 30 km long run."""
    avg_speed_kmh: float | None
    avg_pace_s_per_km: float | None


class LifetimeTotals(PeriodTotals):
    """`totals`: the headline figures, plus how long they were collected over.
    The four span fields are absent on a set with no activities."""

    span_days: int = 0
    span_years: float = 0.0
    activities_per_week: float = 0.0
    distance_km_per_week: float = 0.0


class TypeTotals(PeriodTotals):
    """One row of `by_type`: the same totals for one activity type."""

    activity_type: str


class PeriodRow(PeriodTotals):
    """One row of `by_year`, `by_month` or `/api/aggregate/periods`."""

    period: str
    """`2026`, `2026-09` or `2026-W38`, by the period asked for."""


class MetricChange(_Model):
    """One metric against the year before."""

    delta: float
    """In the metric's own unit, so a `*_km` metric's delta is in km."""
    pct: float
    better: bool
    """Which direction counts as an improvement; for pace, lower."""


class YearRow(PeriodRow):
    changes: dict[str, MetricChange | None]
    """Keyed by `metric_names`; every value is null on the first year, and null for
    a metric the year before had nothing of."""


class YearOverYear(_Model):
    metric_names: list[str]
    """The metrics `changes` is keyed on, in display order."""
    years: list[YearRow]


class HistogramBucket(_Model):
    """One bar of a distribution. `lo` and `hi` are in the histogram's own unit:
    seconds per km for pace, km for distance, minutes for duration, bpm for HR."""

    lo: float
    hi: float
    count: int


class HrZoneShare(_Model):
    zone: int
    """1-5."""
    seconds: float
    hours: float
    pct: float
    """Share of all zone time in the filtered set."""


class Distributions(_Model):
    """How the filtered activities spread out. Pace buckets are a fixed 15 s wide
    between 2:30 and 15:00 /km; the rest are split over the observed range."""

    pace: list[HistogramBucket]
    distance_km: list[HistogramBucket]
    duration_min: list[HistogramBucket]
    avg_hr: list[HistogramBucket]
    hr_zones: list[HrZoneShare]
    sample_size: int
    """Activities behind the histograms, including those with nothing to bucket."""


class WeekdayBucket(_Model):
    day: int
    """0 = Monday."""
    name: str
    count: int
    distance_km: float
    hours: float


class HourBucket(_Model):
    hour: int
    """0-23, by the activity's local start time."""
    count: int
    distance_km: float


class MonthBucket(_Model):
    month: int
    """1-12, across every year."""
    name: str
    count: int
    distance_km: float


class Patterns(_Model):
    """When training actually happens."""

    day_of_week: list[WeekdayBucket]
    hour_of_day: list[HourBucket]
    month_of_year: list[MonthBucket]
    dow_hour_matrix: list[list[int]]
    """7 rows (Monday first) of 24 counts. Activities with no start time are
    counted in `day_of_week` but not here, so the rows need not sum to `count`."""
    busiest_day: str | None
    peak_hour: int | None
    total: int


class BiggestWeek(_Model):
    week: str
    activities: int
    distance_km: float
    hours: float


class AggregateStreaks(_Model):
    """Consistency over the filtered set. Distinct from `Streaks` on `/api/reports`,
    which counts wellness days rather than filtered activities."""

    current: int
    """0 unless the streak reaches today or yesterday."""
    longest: int
    longest_end: str | None
    active_days: int
    span_days: int = 0
    """Absent on a set with no activities, along with the three below."""
    rest_days: int
    active_pct: float | None = None
    biggest_week: BiggestWeek | None


class AggregateBestEffort(_Model):
    """Fastest effort at a standard distance within the filter."""

    distance_m: float
    label: str
    seconds: float
    day: str
    activity_id: str
    activity_name: str | None


#: `aggregate.records`, in order. The key says how `raw` reads: metres, seconds,
#: metres of climb, metres per second, bpm, and TRIMP.
ExtremeKey = Literal[
    "longest_distance", "longest_duration", "most_elevation",
    "fastest_average", "highest_hr", "biggest_trimp",
]


class Extreme(_Model):
    """The one activity that tops the filtered set on a single measure."""

    key: ExtremeKey
    label: str
    raw: float
    """In the unit `key` implies; `fastest_average` is m/s, not a pace."""
    day: str
    activity_id: str
    activity_name: str | None
    activity_type: str


class Records(_Model):
    best_efforts: list[AggregateBestEffort]
    """Distances never covered are left out rather than shown empty."""
    extremes: list[Extreme]


class AppliedFilters(_Model):
    """The filters this response was computed under; keys the caller left out are
    absent rather than null."""

    activity_type: str | None = None
    start: str | None = None
    end: str | None = None
    gear_id: int | None = None


class Aggregate(_Model):
    """`GET /api/aggregate`: everything the Trends aggregates need in one call."""

    filters: AppliedFilters
    totals: LifetimeTotals
    by_type: list[TypeTotals]
    """Busiest type first. Never filtered by type, whatever was asked for."""
    by_year: list[PeriodRow]
    by_month: list[PeriodRow]
    """Oldest first; months with no activity are absent, not zero rows."""
    year_over_year: YearOverYear
    distributions: Distributions
    patterns: Patterns
    streaks: AggregateStreaks
    records: Records


class AggregatePeriods(_Model):
    """`GET /api/aggregate/periods`: one block of `Aggregate`, by week if wanted."""

    period: Literal["year", "month", "week"]
    rows: list[PeriodRow]


class FilterType(_Model):
    value: str
    n: int
    """Activities of this type, before any other filter."""


class FilterGear(_Model):
    gear_id: int
    kind: GearKind
    brand: str | None
    model: str | None
    nickname: str | None
    n: int


class FilterRange(_Model):
    first_day: str | None
    last_day: str | None


class AggregateFilters(_Model):
    """`GET /api/aggregate/filters`: what the filter bar can offer."""

    types: list[FilterType]
    gear: list[FilterGear]
    range: FilterRange


class MonthlyReportRow(_Model):
    """One calendar month of activity and wellness totals (`reports.monthly_report`)."""

    month: str
    sessions: int
    km: float
    """All sports."""
    run_km: float
    hours: float
    trimp: float
    elev_m: int
    rhr: float | None
    hrv: float | None
    sleep_score: float | None
    weight_kg: float | None
    vo2max: float | None
    km_delta_pct: float | None
    """Running km change vs the previous month, percent."""
    trimp_delta_pct: float | None


class WeekdayShare(_Model):
    weekday: str
    count: int
    pct: float


class Reports(_Model):
    """`GET /api/reports`: the rolling weekly and monthly tables behind the summary."""

    weekly: list[WeeklyReportRow]
    monthly: list[MonthlyReportRow]
    streaks: Streaks
    weekday_consistency: list[WeekdayShare]
    totals: ReportTotals


# ---------------------------------------------------------------------------
# Health, Garmin and sync
# ---------------------------------------------------------------------------


class Health(_Model):
    status: Literal["ok"]
    version: str
    db: str
    """Path of the SQLite database file."""
    day_range: DayRange
    synthetic: bool
    server_time: str
    """Server local time, ISO-8601 to the second, no offset."""


class GarminStatus(_Model):
    """Whether a Garmin token cache exists. Checked on disk, not against Garmin."""

    connected: bool
    token_dir: str
    tokens_updated_at: str | None
    """ISO-8601 UTC (trailing Z) mtime of the token file; null when not connected."""


class GarminLoginRequest(_Model):
    """`POST /api/garmin/login` body. The password is exchanged for tokens and then
    dropped; nothing here is stored."""

    model_config = ConfigDict(extra="forbid")

    email: str
    password: str


class GarminMfaRequest(_Model):
    """`POST /api/garmin/mfa` body: the code, against the challenge the login gave."""

    model_config = ConfigDict(extra="forbid")

    challenge_id: str
    code: str


class GarminTicketRequest(_Model):
    """`POST /api/garmin/ticket` body: what the browser sign-in left in the address
    bar. The whole URL is accepted; the `ticket=ST-…` is pulled out of it."""

    model_config = ConfigDict(extra="forbid")

    ticket: str


class GarminConnected(GarminStatus):
    """A finished sign-in, by any of the three routes. Carries the new status, so a
    caller does not have to re-read `/api/garmin/status` to know the tokens landed."""

    status: Literal["ok"]
    display_name: str
    """Garmin's own name for the account, as it answers on sign-in."""


class GarminMfaRequired(_Model):
    """A login Garmin paused for a code. The challenge is held in the server's
    memory for `expires_in_s` and is single-use."""

    status: Literal["mfa_required"]
    challenge_id: str
    expires_in_s: int


#: `POST /api/garmin/login` answers one of two shapes. Discriminated on `status`, so
#: the generated TypeScript narrows on it rather than offering an either-or of optionals.
GarminLoginResult = Annotated[
    GarminConnected | GarminMfaRequired, Field(discriminator="status")
]


class GarminSigninUrl(_Model):
    """The Garmin page a real browser has to open (D44)."""

    url: str


class GarminDisconnected(GarminStatus):
    status: Literal["ok"]
    removed_files: int
    """0 when there was no token cache to delete."""


class SyncCursor(_Model):
    """The backfill's resume point. Holds only the keys the last checkpoint wrote:
    `activity_offset` + `oldest_day` mid activity list, `oldest_day` after it,
    `last_activity` + `phase` during details. `{}` before any run."""

    activity_offset: int | None = None
    oldest_day: str | None = None
    last_activity: str | None = None
    phase: Literal["details"] | None = None


class Watermark(_Model):
    """One `sync_watermark` row: how far an endpoint has been synced."""

    endpoint: str
    """Open vocabulary: a Connect endpoint name, "activities", "export_zip", ..."""
    last_day: str | None
    last_run_at: str | None
    status: Literal["ok", "error", "partial", "rate_limited"] | None
    """`rate_limited` is Google Health's: the place is kept and the next run resumes."""
    note: str | None


class SyncStatus(_Model):
    """`GET /api/sync/status`: the backfill's durable progress plus this process's
    worker thread."""

    job: Literal["backfill"]
    state: SyncState
    phase: SyncPhase | Literal["starting", ""] | None
    """The phase last checkpointed. "starting" before the first phase begins; ""
    when a run failed before reaching any phase; null before any run."""
    done: int
    total: int | None
    """Null when unknown (or zero)."""
    pct: float | None
    eta_s: float | None
    """Estimated seconds left in the current phase."""
    message: str | None
    """Human-readable progress or error text."""
    started_at: str | None
    updated_at: str | None
    finished_at: str | None
    cursor: SyncCursor
    phases: list[SyncPhase]
    """Every phase a full run goes through, in order."""
    thread_running: bool
    """Whether this server process's worker thread is alive."""
    last_error: str | None
    """The exception that ended this process's last run, if it raised."""
    watermarks: list[Watermark]


class SyncStartRequest(_Model):
    """`POST /api/sync/start` body. Both keys optional; `{}` or no body runs a full
    backfill."""

    model_config = ConfigDict(extra="forbid")

    phases: list[SyncPhase] | None = None
    """Phases to run; null or empty means all of them."""
    detail_limit: int | None = Field(None, ge=0)
    """Cap on activity streams fetched this run; null or 0 means no cap."""


class SyncStarted(_Model):
    status: Literal["started"]
    phases: list[SyncPhase]


class AutoSyncSource(_Model):
    """How one source fared in the last automatic run."""

    state: Literal["done", "skipped", "error"]
    """`skipped` when the source is not connected."""
    message: str


class AutoSyncStatus(_Model):
    """`GET /api/sync/auto`: the scheduler that syncs without the button (D8)."""

    enabled: bool
    interval_hours: float
    """0 when off (`GA_AUTO_SYNC_HOURS=0`)."""
    running: bool
    """A run is in progress in this process right now."""
    state: SyncState | None
    """The last run's outcome; null before the first one."""
    message: str | None
    started_at: str | None
    finished_at: str | None
    next_run_at: str | None
    """Null when off. In the past when a run is due and waiting on a manual sync."""
    sources: dict[Literal["garmin", "fitbit", "plan"], AutoSyncSource]
    """One entry per source the automatic run touched. **Widen this when a source is
    added**: a key the Literal does not allow makes `/api/sync/auto` answer 500, which
    is how adding the plan announced itself."""


class SyncStopResult(_Model):
    stopping: bool
    """False when no sync was running."""


class SyncEstimate(_Model):
    """`GET /api/sync/estimate`: roughly how big a full backfill would be.

    A range, not a number: the per-request delay dominates and Garmin's throttling
    is not predictable. The rendered `estimated_low` / `estimated_high` strings the
    old dashboard used are gone; the seconds they were built from are here.
    """

    first_day: str
    last_day: str
    days: int
    activities_pending_details: int
    """Activities whose per-sample streams have not been fetched yet."""
    daily_endpoints: int
    """How many Connect endpoints are fetched per day of history."""
    estimated_requests: int
    estimated_seconds_low: int
    estimated_seconds_high: int


class OverrideFieldCount(_Model):
    """How many activities carry an edit to one field."""

    field: str
    n: int


class OverridesSummary(_Model):
    """`GET /api/overrides`: how much of the data the user has corrected.

    Exercise relabels are one number rather than one `by_field` row per exercise
    index, which would be a list of noise.
    """

    total: int
    activities_edited: int
    exercise_relabels: int
    by_field: list[OverrideFieldCount]
    fields: list[EditableFieldInfo]
    """The registry, so a field's count can be labelled without a second request."""


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------


class ConfigAthlete(_Model):
    hr_rest: int
    hr_max: int
    sex: str


class AppConfig(_Model):
    """`GET /api/config`: non-secret configuration, so a view can label its own
    assumptions. Nothing here is a credential.

    There is no `targets` block any more. The two numbers it held were invented, and
    the real ones belong to the plan rather than to the deployment, so they are on
    `/api/plan` and `/api/race` (D12)."""

    race: RaceInfo | None
    """The race from the training calendar, or null when none is named ahead (T57).
    It used to be four constants in `config.py`, which went on counting down after the
    race was run."""
    athlete: ConfigAthlete
    auth_required: bool
    version: str


# ---------------------------------------------------------------------------
# Training plan
# ---------------------------------------------------------------------------

PlanVerdict = Literal[
    "done", "short", "missed", "substituted", "rest-kept", "rest-broken", "upcoming"
]
"""What became of a prescribed day. There is deliberately no `over`: running further
than prescribed is not a deviation."""


class PlanSource(_Model):
    """The subscribed calendar. The address is **always masked** — a private iCal URL is
    read access to the whole calendar to anyone holding it."""

    label: str | None
    url_masked: str
    last_fetch_at: str | None
    last_error: str | None
    start_day: str | None = None
    """The day this block began. Null means the plan is whatever the calendar holds —
    right for a training-only calendar, and wrong for a general one, where a
    long-standing recurring event backfills years of sessions nobody prescribed."""


class PlanWeek(_Model):
    week: str
    """ISO week, `2026-W50`."""
    start: str
    sessions_prescribed: int = 0
    """Everything the week asks for, over the same days as `planned_km`. Show these two
    together; pairing `sessions_planned` with `planned_km` compares days so far against
    all seven."""
    sessions_planned: int
    """Only what can be judged yet: excludes optional sessions, ones the owner ignored,
    and days still to come. Adherence's denominator, so mid-week it is below
    `sessions_prescribed`."""
    sessions_done: int
    adherence_pct: float | None
    """Weighted: the long run counts for more than an easy day. Null when the week
    prescribed nothing that could be judged."""
    planned_km: float
    """What the whole week asks for, including days not yet due — `targets` reads the
    plan's peak week from this, and a build's peak is ahead of today."""
    actual_km: float
    long_run: PlanVerdict | None
    substitutions: int


class PlanSession(_Model):
    """One prescribed day, and what fulfilled it."""

    day: str
    sport: str | None
    kind: str | None
    planned_min_m: float | None
    planned_max_m: float | None
    """Equal to `planned_min_m` unless the plan gave a range (`8-10 km`)."""
    title: str
    optional: bool
    """The calendar's own word: a session that was never owed."""
    ignored: bool
    """The owner's word, said afterwards. Still shown, so a denominator never falls
    without a visible reason, but out of every adherence figure."""
    session_ids: list[int]
    """The calendar events collapsed into this one prescription."""
    verdict: PlanVerdict
    activity_id: str | None
    actual_sport: str | None
    """Set and different from `sport` when the session was substituted."""
    actual_m: float | None
    actual_s: float | None
    moved_from: str | None
    """The day the fulfilling activity actually happened, when it was not this one."""


class ActivityPlan(_Model):
    """`GET /api/activities/{id}/plan`: what the plan asked of this activity, and what it
    asks next of the same kind."""

    session: PlanSession | None
    """The prescribed session this activity fulfilled. Null for an activity that was not
    part of the plan."""
    next: PlanSession | None
    """The next session of the same kind and sport still to come. Null without one."""


class PlanUnreadable(_Model):
    """A session the parser could not resolve. Shown in Settings so a silent miss is a
    visible one."""

    id: int
    day: str
    title: str | None
    description: str | None
    parse_status: str


class PlanUnplanned(_Model):
    activity_id: str
    day: str
    activity_type: str
    activity_name: str | None = None
    distance_m: float | None = None
    duration_s: float | None = None


class PlanDecision(_Model):
    """A match the owner overruled by hand. The only part of the plan's judgement that
    is stored rather than recomputed, which is why Settings lists it."""

    plan_session_id: int
    day: str
    title: str | None
    link_type: Literal["manual", "ignored"]
    activity_id: str | None
    """Null for `ignored`."""
    linked_at: str | None


class Plan(_Model):
    """`GET /api/plan`. With no calendar subscribed this is a 200 with
    `subscribed: false`, never a 404."""

    subscribed: bool
    source: PlanSource | None
    today: str
    weeks: list[PlanWeek]
    adherence_4wk: float | None
    this_week: PlanWeek | None
    next_session: PlanSession | None
    decisions: list[PlanDecision]
    targets: PlanTargets
    unreadable: list[PlanUnreadable]
    unplanned: list[PlanUnplanned]


class PlanWeekDetail(_Model):
    """`GET /api/plan/week`."""

    week: str
    start: str
    summary: PlanWeek | None
    sessions: list[PlanSession]
    unplanned: list[PlanUnplanned]


class PlanSessionList(_Model):
    """Every judged session in the plan at once, for the calendar.

    One request rather than one per week: the grid draws the whole block, and the
    sessions carry their own `day`, so the view buckets them itself."""

    today: str
    sessions: list[PlanSession]
    unplanned: list[PlanUnplanned]


class PlanSourceRequest(_Model):
    url: str
    """The calendar's secret iCal address. Stored, never returned."""
    label: str | None = None


class PlanStartRequest(_Model):
    start_day: str | None = None
    """The day this block began, `2026-09-01`. Null clears it back to the whole
    calendar. Sessions before it leave every figure the plan reports; nothing is
    deleted, so moving the line back brings them straight home."""


class PlanSyncResult(_Model):
    status: Literal["ok", "unchanged", "skipped"]
    reason: str | None = None
    sessions: int = 0
    withdrawn: int = 0
    unsupported: int = 0
    parsed_ok: int = 0
    parsed_unparsed: int = 0


class PlanLinkRequest(_Model):
    activity_id: str | None = None
    """Null with `ignore` true, or to clear the link."""
    ignore: bool = False


class PlanLinkResult(_Model):
    plan_session_id: int
    activity_id: str | None
    link_type: Literal["manual", "ignored", "cleared"]
