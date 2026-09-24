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

from pydantic import BaseModel, ConfigDict, Field

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


# ---------------------------------------------------------------------------
# Status: summary, training load, readiness, race, health, Garmin and sync
# ---------------------------------------------------------------------------
#
# Some of these handlers leave keys out in some states (an empty database, a sync
# cursor that only ever holds the keys of the phase that wrote it). Fields for those
# keys have a default and their routes use `response_model_exclude_unset`, so an
# absent key stays absent instead of turning into an explicit null. In OpenAPI they
# are simply not `required`.

#: A JSON number that may come out as an int or a float, and must keep which one it
#: was. Pydantic turns an int into a float for a plain `float` field, which would
#: change `1000` into `1000.0` on the wire.
Number = int | float

#: `trends.TREND_METRICS`: every metric `compute_trends` scores by default.
TrendMetric = Literal[
    "resting_hr", "hrv", "sleep_score", "total_sleep_s", "bb_high", "stress_avg"
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


class TrendFlag(_Model):
    """A recovery metric whose latest value is at least `z_threshold` sigma off its
    own trailing baseline."""

    metric: TrendMetric
    z: float
    verdict: Literal["better than baseline", "worse than baseline"]


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
    name: str
    date: str
    """ISO date."""
    start_local: str
    """Gun time, HH:MM local to `timezone`."""
    timezone: str
    """IANA zone name."""
    distance_m: float


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


class RacePanel(_Model):
    """`GET /api/race`: countdown, projection and the CTL / volume gap to target."""

    race: RaceInfo
    today: str
    days_to_go: int
    """Negative once the race has passed."""
    weeks_to_go: float
    projection: RaceProjection | None
    """Null with no usable best effort."""
    ctl_now: float
    ctl_target: float
    ctl_per_week_needed: float | None
    """Straight-line CTL gain per week to reach the target; null inside the last
    week."""
    tsb_now: float | None
    weekly_km: list[RaceWeekKm]
    """The last 26 weeks with any running."""
    weekly_km_avg_4wk: float
    """Running km/week over the 28 days ending on the last activity."""
    weekly_km_target: float
    recent_bests: list[PersonalBest]
    """Bests from the last 120 days of activities."""
    notes: list[RaceNote]


class SummaryRace(_Model):
    """The race countdown, cut down for the summary."""

    name: str
    date: str
    distance_m: float
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
    race: SummaryRace
    recent_weeks: list[WeeklyReportRow]
    """Up to the last eight weeks with activity."""


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
    status: Literal["ok", "error", "partial"] | None
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


class SyncStopResult(_Model):
    stopping: bool
    """False when no sync was running."""
