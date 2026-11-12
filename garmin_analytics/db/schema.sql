-- Garmin Analytics schema.
--
-- Conventions:
--   * `day` columns are ISO dates (YYYY-MM-DD) in the athlete's local time.
--   * timestamps are ISO-8601 strings, UTC, with a trailing Z.
--   * every table that originates from a fetched payload keeps `raw_id` pointing at
--     the verbatim document it was normalised from, so re-parsing never needs re-fetching.

CREATE TABLE IF NOT EXISTS schema_migrations (
    version     INTEGER PRIMARY KEY,
    name        TEXT NOT NULL,
    applied_at  TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- Raw-first archive
-- ---------------------------------------------------------------------------

-- Verbatim payloads. Nothing is ever discarded: fields we do not model still live here.
-- `ref_key` is the natural key for the payload (a date, an activity id, a filename).
-- `content_hash` makes re-ingest idempotent: an identical payload is not stored twice.
CREATE TABLE IF NOT EXISTS raw_documents (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    source        TEXT NOT NULL,          -- connect | export_zip | fitfile | seed
    endpoint      TEXT NOT NULL,          -- logical collection, e.g. 'sleep', 'activities'
    ref_key       TEXT NOT NULL,          -- date, activity id, or file name
    fetched_at    TEXT NOT NULL,
    content_hash  TEXT NOT NULL,
    payload       TEXT NOT NULL,          -- JSON text, verbatim
    UNIQUE (source, endpoint, ref_key, content_hash)
);
CREATE INDEX IF NOT EXISTS idx_raw_endpoint_ref ON raw_documents (endpoint, ref_key);

-- Per-endpoint incremental progress. Re-running a sync starts from `last_day`.
CREATE TABLE IF NOT EXISTS sync_watermark (
    endpoint     TEXT PRIMARY KEY,
    last_day     TEXT,                    -- most recent day successfully ingested
    last_run_at  TEXT,
    status       TEXT,                    -- ok | error | partial
    note         TEXT
);

-- ---------------------------------------------------------------------------
-- Activities
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS activities (
    activity_id        TEXT PRIMARY KEY,
    day                TEXT NOT NULL,     -- local date of start
    start_time_local   TEXT NOT NULL,
    start_time_utc     TEXT,
    activity_type      TEXT NOT NULL,     -- running | cycling | swimming | walking | strength | other
    activity_name      TEXT,
    distance_m         REAL,
    duration_s         REAL,              -- elapsed
    moving_time_s      REAL,
    avg_hr             REAL,
    max_hr             REAL,
    avg_speed_mps      REAL,              -- distance / moving time
    max_speed_mps      REAL,
    elevation_gain_m   REAL,
    calories           REAL,
    avg_cadence_spm    REAL,              -- steps/min for runs, rpm for bikes
    avg_power_w        REAL,
    training_effect_aerobic    REAL,
    training_effect_anaerobic  REAL,
    trimp              REAL,              -- computed at normalise time (Banister)
    raw_id             INTEGER REFERENCES raw_documents (id)
);
CREATE INDEX IF NOT EXISTS idx_activities_day ON activities (day);
CREATE INDEX IF NOT EXISTS idx_activities_type ON activities (activity_type);

-- Time in each HR zone, per activity. zone 1..5.
CREATE TABLE IF NOT EXISTS activity_hr_zones (
    activity_id  TEXT NOT NULL REFERENCES activities (activity_id) ON DELETE CASCADE,
    zone         INTEGER NOT NULL,
    seconds      REAL NOT NULL,
    PRIMARY KEY (activity_id, zone)
);

-- Per-activity sample stream (from FIT files, or synthesised by the seeder).
-- Sparse by design: only what a run analysis needs.
-- `lat`/`lon` are WGS-84 degrees and are NULL for indoor activities: every reader
-- must cope with a stream that has no position at all (treadmills, turbo, pool).
CREATE TABLE IF NOT EXISTS activity_samples (
    activity_id   TEXT NOT NULL REFERENCES activities (activity_id) ON DELETE CASCADE,
    elapsed_s     REAL NOT NULL,
    distance_m    REAL,
    hr            REAL,
    speed_mps     REAL,
    cadence_spm   REAL,
    power_w       REAL,
    altitude_m    REAL,
    lat           REAL,
    lon           REAL,
    PRIMARY KEY (activity_id, elapsed_s)
);
CREATE INDEX IF NOT EXISTS idx_samples_gps
    ON activity_samples (activity_id) WHERE lat IS NOT NULL;

-- The watch's own laps, as Garmin's /splits endpoint reports them. A structured workout
-- (4 min run / 1 min walk, say) gives one lap per step, tagged with the step's intensity,
-- so the intervals are what the watch timed, not something guessed from the stream.
-- `start_offset_s` is the lap's start in the activity's elapsed time, so a lap lines up
-- with `activity_samples.elapsed_s`. `intensity` is Garmin's: WARMUP, ACTIVE, REST,
-- RECOVERY, COOLDOWN, INTERVAL; NULL when the lap was a manual or auto lap.
-- `avg_cadence_spm` is steps per minute, as on `activities` (the stream stores half).
CREATE TABLE IF NOT EXISTS activity_laps (
    activity_id      TEXT NOT NULL REFERENCES activities (activity_id) ON DELETE CASCADE,
    lap_index        INTEGER NOT NULL,
    start_offset_s   REAL,
    duration_s       REAL,
    distance_m       REAL,
    intensity        TEXT,
    wkt_step_index   INTEGER,
    avg_hr           REAL,
    max_hr           REAL,
    avg_speed_mps    REAL,
    avg_cadence_spm  REAL,
    elevation_gain_m REAL,
    PRIMARY KEY (activity_id, lap_index)
);

-- The workout the watch ran, step by step: Garmin's /workouts endpoint for the activity.
-- `step_index` is what `activity_laps.wkt_step_index` points at. Durations are seconds
-- (TIME) or metres (DISTANCE); OPEN means "until the lap button". Targets keep Garmin's
-- encoding: SPEED low/high in m/s, CADENCE in steps/min, HEART_RATE either bpm in
-- low/high or a zone number in `target_value`; OPEN or NULL is no target. A repeat step
-- (`duration_type` REPEAT_*) goes back to step `duration_value`, `target_value` times.
CREATE TABLE IF NOT EXISTS activity_workout_steps (
    activity_id    TEXT NOT NULL REFERENCES activities (activity_id) ON DELETE CASCADE,
    workout_index  INTEGER NOT NULL,
    step_index     INTEGER NOT NULL,
    intensity      TEXT,
    duration_type  TEXT,
    duration_value REAL,
    target_type    TEXT,
    target_value   REAL,
    target_low     REAL,
    target_high    REAL,
    PRIMARY KEY (activity_id, workout_index, step_index)
);

-- Rolling best efforts extracted from sample streams (fastest window for a distance).
CREATE TABLE IF NOT EXISTS best_efforts (
    activity_id  TEXT NOT NULL REFERENCES activities (activity_id) ON DELETE CASCADE,
    distance_m   REAL NOT NULL,
    seconds      REAL NOT NULL,
    day          TEXT NOT NULL,
    PRIMARY KEY (activity_id, distance_m)
);
CREATE INDEX IF NOT EXISTS idx_best_efforts_dist ON best_efforts (distance_m, seconds);

-- ---------------------------------------------------------------------------
-- Daily wellness
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS sleep (
    day                TEXT PRIMARY KEY,  -- the calendar date the sleep ENDED on
    total_sleep_s      REAL,
    deep_s             REAL,
    light_s            REAL,
    rem_s              REAL,
    awake_s            REAL,
    sleep_score        REAL,
    overnight_hrv_ms   REAL,
    avg_respiration_brpm REAL,
    avg_spo2_pct       REAL,
    bedtime_local      TEXT,
    waketime_local     TEXT,
    raw_id             INTEGER REFERENCES raw_documents (id)
);

CREATE TABLE IF NOT EXISTS daily_wellness (
    day                   TEXT PRIMARY KEY,
    resting_hr            REAL,
    steps                 INTEGER,
    floors                INTEGER,
    calories_total        REAL,
    calories_active       REAL,
    intensity_minutes_mod INTEGER,
    intensity_minutes_vig INTEGER,
    stress_avg            REAL,
    stress_max            REAL,
    bb_high               INTEGER,   -- Body Battery
    bb_low                INTEGER,
    bb_charged            INTEGER,
    bb_drained            INTEGER,
    raw_id                INTEGER REFERENCES raw_documents (id)
);

CREATE TABLE IF NOT EXISTS hrv_daily (
    day             TEXT PRIMARY KEY,
    last_night_avg  REAL,
    last_night_5min_high REAL,
    weekly_avg      REAL,      -- Garmin's own 7-day baseline
    baseline_low    REAL,
    baseline_high   REAL,
    status          TEXT,      -- BALANCED | UNBALANCED | LOW | POOR
    raw_id          INTEGER REFERENCES raw_documents (id)
);

CREATE TABLE IF NOT EXISTS fitness (
    day                TEXT PRIMARY KEY,
    vo2max_run         REAL,
    vo2max_cycle       REAL,
    training_status    TEXT,   -- PRODUCTIVE | MAINTAINING | PEAKING | OVERREACHING | ...
    training_readiness INTEGER,
    acute_load         REAL,   -- Garmin's own, when exposed
    chronic_load       REAL,
    raw_id             INTEGER REFERENCES raw_documents (id)
);

CREATE TABLE IF NOT EXISTS body_composition (
    day           TEXT PRIMARY KEY,
    weight_kg     REAL,
    body_fat_pct  REAL,
    bmi           REAL,
    raw_id        INTEGER REFERENCES raw_documents (id)
);

-- Convenience view: one row per day with everything joined, for the trend engine.
-- Dropped first so a changed definition reaches a database that already has the view;
-- the script only runs when the schema fingerprint changes.
DROP VIEW IF EXISTS v_daily;
CREATE VIEW v_daily AS
SELECT d.day                       AS day,
       d.resting_hr                AS resting_hr,
       d.steps                     AS steps,
       -- Garmin writes -1 for "no stress reading". Left in, it plots as a flat line at
       -- the bottom of the chart and drags the baseline down with it.
       CASE WHEN d.stress_avg >= 0 THEN d.stress_avg END AS stress_avg,
       d.bb_high                   AS bb_high,
       d.bb_low                    AS bb_low,
       d.bb_charged                AS bb_charged,
       d.bb_drained                AS bb_drained,
       s.total_sleep_s             AS total_sleep_s,
       s.sleep_score               AS sleep_score,
       s.deep_s                    AS deep_s,
       s.rem_s                     AS rem_s,
       h.last_night_avg            AS hrv,
       h.status                    AS hrv_status,
       f.vo2max_run                AS vo2max_run,
       f.training_status           AS training_status,
       f.training_readiness        AS training_readiness,
       b.weight_kg                 AS weight_kg
FROM daily_wellness d
LEFT JOIN sleep s            ON s.day = d.day
LEFT JOIN hrv_daily h        ON h.day = d.day
LEFT JOIN fitness f          ON f.day = d.day
LEFT JOIN body_composition b ON b.day = d.day;

-- ---------------------------------------------------------------------------
-- User edits (v2)
-- ---------------------------------------------------------------------------

-- Every user correction lives here, NEVER in `activities`. A sync rewrites
-- `activities` freely; the read path is the generated `v_activities` view, which
-- resolves COALESCE(override, garmin_value) per field. That is what makes edits
-- survive a re-sync.
--
-- `value` is TEXT for every field; `value_type` says how to cast it back
-- (text | real | int | bool). `garmin_value_at_edit` snapshots what Garmin said
-- when the edit was made, so "revert to Garmin value" is always possible even if
-- the field is user-only (then it is NULL and revert means delete the row).
CREATE TABLE IF NOT EXISTS overrides (
    activity_id          TEXT NOT NULL REFERENCES activities (activity_id) ON DELETE CASCADE,
    field                TEXT NOT NULL,
    value                TEXT,
    value_type           TEXT NOT NULL DEFAULT 'text',
    garmin_value_at_edit TEXT,
    created_at           TEXT NOT NULL,
    updated_at           TEXT NOT NULL,
    PRIMARY KEY (activity_id, field)
);
CREATE INDEX IF NOT EXISTS idx_overrides_field ON overrides (field, activity_id);

-- ---------------------------------------------------------------------------
-- Gear (v2)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS gear (
    gear_id             INTEGER PRIMARY KEY AUTOINCREMENT,
    kind                TEXT NOT NULL,          -- shoe | bike | strap | other
    brand               TEXT,
    model               TEXT,
    nickname            TEXT,                   -- what the user actually calls it
    purchase_date       TEXT,                   -- ISO date
    initial_distance_m  REAL NOT NULL DEFAULT 0,-- mileage already on it before tracking
    retirement_distance_m REAL,                 -- warn/retire threshold; NULL = no limit
    retired             INTEGER NOT NULL DEFAULT 0,
    notes               TEXT,
    photo_path          TEXT,
    source              TEXT NOT NULL DEFAULT 'manual',  -- manual | garmin
    garmin_uuid         TEXT,                   -- so a Garmin import does not duplicate
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL,
    UNIQUE (garmin_uuid)
);
CREATE INDEX IF NOT EXISTS idx_gear_kind ON gear (kind, retired);

-- Many-to-many: a ride can have a bike AND a HR strap; a run has shoes.
-- `source` distinguishes a deliberate user assignment from one Garmin supplied or
-- a default rule applied — user assignments are never overwritten by a sync.
CREATE TABLE IF NOT EXISTS activity_gear (
    activity_id  TEXT NOT NULL REFERENCES activities (activity_id) ON DELETE CASCADE,
    gear_id      INTEGER NOT NULL REFERENCES gear (gear_id) ON DELETE CASCADE,
    source       TEXT NOT NULL DEFAULT 'manual', -- manual | garmin | default_rule
    assigned_at  TEXT NOT NULL,
    PRIMARY KEY (activity_id, gear_id)
);
CREATE INDEX IF NOT EXISTS idx_activity_gear_gear ON activity_gear (gear_id);

-- Default gear per activity type. Applied to NEW activities only, never
-- retrospectively — retrospective changes are the user's bulk-reassign action.
CREATE TABLE IF NOT EXISTS gear_defaults (
    activity_type  TEXT NOT NULL,
    gear_id        INTEGER NOT NULL REFERENCES gear (gear_id) ON DELETE CASCADE,
    created_at     TEXT NOT NULL,
    PRIMARY KEY (activity_type, gear_id)
);

-- ---------------------------------------------------------------------------
-- Routes (v2)
-- ---------------------------------------------------------------------------

-- A cluster of activities that follow substantially the same path.
-- `signature` is the downsampled, grid-snapped track used for matching;
-- `points` is the representative polyline (JSON [[lat,lon,alt,dist_m], ...]).
-- `pinned` is set when the user has renamed/merged/split it: clustering must not
-- silently undo a human decision.
CREATE TABLE IF NOT EXISTS routes (
    route_id       INTEGER PRIMARY KEY AUTOINCREMENT,
    name           TEXT NOT NULL,
    activity_type  TEXT NOT NULL,
    signature      TEXT NOT NULL,
    points         TEXT NOT NULL,
    distance_m     REAL NOT NULL,
    elevation_gain_m REAL,
    start_lat      REAL NOT NULL,
    start_lon      REAL NOT NULL,
    end_lat        REAL NOT NULL,
    end_lon        REAL NOT NULL,
    centroid_lat   REAL NOT NULL,
    centroid_lon   REAL NOT NULL,
    is_loop        INTEGER NOT NULL DEFAULT 0,
    pinned         INTEGER NOT NULL DEFAULT 0,  -- user renamed / merged / split it
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_routes_type ON routes (activity_type);

CREATE TABLE IF NOT EXISTS route_members (
    activity_id  TEXT PRIMARY KEY REFERENCES activities (activity_id) ON DELETE CASCADE,
    route_id     INTEGER NOT NULL REFERENCES routes (route_id) ON DELETE CASCADE,
    match_score  REAL,                          -- 0..1 path overlap at assignment time
    assigned     TEXT NOT NULL DEFAULT 'auto',  -- auto | manual
    assigned_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_route_members_route ON route_members (route_id);

-- Per-attempt, per-segment splits along a route. Recomputed when membership
-- changes; cached here because the aggregation is over every attempt ever.
CREATE TABLE IF NOT EXISTS route_segment_efforts (
    route_id     INTEGER NOT NULL REFERENCES routes (route_id) ON DELETE CASCADE,
    activity_id  TEXT NOT NULL REFERENCES activities (activity_id) ON DELETE CASCADE,
    seg_index    INTEGER NOT NULL,
    start_m      REAL NOT NULL,
    end_m        REAL NOT NULL,
    seconds      REAL,
    speed_mps    REAL,
    avg_hr       REAL,
    avg_cadence_spm REAL,
    gradient_pct REAL,
    PRIMARY KEY (route_id, activity_id, seg_index)
);
CREATE INDEX IF NOT EXISTS idx_segment_efforts_seg ON route_segment_efforts (route_id, seg_index);

-- ---------------------------------------------------------------------------
-- App state (v2): sync progress, auth sessions, key/value settings
-- ---------------------------------------------------------------------------

-- Single row per job name. The UI polls /api/sync/status; a backfill checkpoints
-- here after every activity so an interrupted run can report where it stopped.
CREATE TABLE IF NOT EXISTS sync_status (
    job          TEXT PRIMARY KEY,      -- 'backfill' | 'sync'
    state        TEXT NOT NULL,         -- idle | running | done | error | cancelled
    phase        TEXT,                  -- human-readable current step
    done         INTEGER NOT NULL DEFAULT 0,
    total        INTEGER,
    started_at   TEXT,
    updated_at   TEXT,
    finished_at  TEXT,
    eta_s        REAL,
    message      TEXT,
    cursor       TEXT                   -- JSON resume cursor
);

CREATE TABLE IF NOT EXISTS app_settings (
    key         TEXT PRIMARY KEY,
    value       TEXT,
    updated_at  TEXT NOT NULL
);

-- Session cookies live on the volume so a container restart does not log the
-- user out. `token_hash` only — the raw token is never stored.
CREATE TABLE IF NOT EXISTS sessions (
    token_hash  TEXT PRIMARY KEY,
    created_at  TEXT NOT NULL,
    expires_at  TEXT NOT NULL,
    label       TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions (expires_at);

-- ---------------------------------------------------------------------------
-- Training plan (v3): what was prescribed, and what fulfilled it
-- ---------------------------------------------------------------------------

-- A subscribed calendar. `url` is a *secret* — anyone holding a Google private
-- iCal address can read the whole calendar — so it is masked everywhere it leaves
-- the API and must never reach a log line.
CREATE TABLE IF NOT EXISTS plan_sources (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    kind           TEXT NOT NULL,          -- 'ics'
    url            TEXT NOT NULL,
    label          TEXT,
    etag           TEXT,                   -- for If-None-Match; a 304 is a good no-op run
    last_modified  TEXT,
    last_fetch_at  TEXT,
    last_error     TEXT,
    enabled        INTEGER NOT NULL DEFAULT 1,
    -- The day this training block began. NULL means "whatever the calendar holds",
    -- which is right for a calendar kept only for training and wrong for a general one:
    -- a weekly club run that has sat in it for years would otherwise backfill the plan
    -- with sessions nobody ever prescribed.
    start_day      TEXT,
    UNIQUE (kind, url)
);

-- One prescribed session. Identified the way iCalendar identifies it: `uid` names the
-- event or the series, and `recurrence_id` names one instance within a series — which
-- is what lets a single weekly rule hold a different prescription each week, and lets
-- one instance be moved or cancelled without touching its siblings.
--
-- `withdrawn_at` is the point of this table rather than a soft-delete habit. A series
-- deleted in the calendar takes its past instances with it (that is what Google does),
-- so a table that mirrored the feed would quietly rewrite finished weeks and move an
-- adherence number that was already earned. A row that leaves the feed is stamped and
-- kept; a past week is always judged against what was prescribed at the time.
CREATE TABLE IF NOT EXISTS plan_sessions (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    -- Nullable, and SET NULL rather than CASCADE: unsubscribing from a calendar must
    -- not delete the record of what it prescribed, which is the whole reason this
    -- table keeps withdrawn rows. A session whose source is gone is an orphan with a
    -- history, not a row to collect.
    source_id           INTEGER REFERENCES plan_sources (id) ON DELETE SET NULL,
    uid                 TEXT NOT NULL,      -- iCalendar UID
    recurrence_id       TEXT NOT NULL,      -- RECURRENCE-ID, or the expanded instance's date
    day                 TEXT NOT NULL,      -- local date, same basis as activities.day
    start_local         TEXT,               -- ISO-8601 local, null for an all-day event
    end_local           TEXT,
    sport               TEXT,               -- running | cycling | strength | rest | other
    kind                TEXT,               -- easy | long | quality | cross | gym | rest | race
    planned_min_m       REAL,               -- a range sets both; a single value sets both equal
    planned_max_m       REAL,
    planned_duration_s  REAL,
    title               TEXT,
    description         TEXT,
    optional            INTEGER NOT NULL DEFAULT 0,  -- `(optional)`; owed nothing, scored nothing
    recurring           INTEGER NOT NULL DEFAULT 0,  -- an instance of an RRULE series
    parse_source        TEXT,               -- hint | week-note | title: which layer decided
    parse_status        TEXT NOT NULL,      -- pending | ok | unparsed | unsupported_rrule
    withdrawn_at        TEXT,               -- set when it leaves the feed; never deleted
    raw_id              INTEGER REFERENCES raw_documents (id),
    UNIQUE (source_id, uid, recurrence_id)
);
CREATE INDEX IF NOT EXISTS idx_plan_sessions_day ON plan_sessions (day);
CREATE INDEX IF NOT EXISTS idx_plan_sessions_live ON plan_sessions (withdrawn_at, day);

-- Which activity fulfilled which prescribed session. Only decisions the owner made by
-- hand are stored: `auto` rows are the matcher's own output, rewritten on every run so
-- that retyping an activity moves its match with it.
--
-- The UNIQUE on `activity_id` is load-bearing: without it one long run could satisfy
-- both Thursday and Friday and hand out an adherence number nobody earned.
CREATE TABLE IF NOT EXISTS plan_links (
    plan_session_id  INTEGER NOT NULL REFERENCES plan_sessions (id) ON DELETE CASCADE,
    activity_id      TEXT REFERENCES activities (activity_id),
    link_type        TEXT NOT NULL,         -- auto | manual | ignored
    score            REAL,
    linked_at        TEXT NOT NULL,
    PRIMARY KEY (plan_session_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_plan_links_activity
    ON plan_links (activity_id) WHERE activity_id IS NOT NULL;

-- The weather an outdoor activity was done in, one row per activity, taken once from
-- Open-Meteo and never asked for again. Every figure is the average over the hours the
-- activity ran (weighted by how much of each hour it covered) at its first GPS fix;
-- `wind_dir_deg` is the direction the wind blows FROM, 0 = north, a vector mean weighted
-- by speed; `gust_kmh` is the highest hour's. `source` is `archive` (the ERA5 reanalysis,
-- final) or `forecast` (the recent past from the forecast models, which the archive
-- replaces about a week later). Nothing here is Garmin's: the watch sync carries no weather.
CREATE TABLE IF NOT EXISTS activity_weather (
    activity_id    TEXT PRIMARY KEY REFERENCES activities (activity_id) ON DELETE CASCADE,
    fetched_at     TEXT NOT NULL,
    source         TEXT NOT NULL,         -- archive | forecast
    lat            REAL NOT NULL,
    lon            REAL NOT NULL,
    temp_c         REAL,
    feels_like_c   REAL,
    humidity_pct   REAL,
    dew_point_c    REAL,
    wind_kmh       REAL,
    wind_dir_deg   REAL,
    gust_kmh       REAL,
    precip_mm      REAL,
    cloud_pct      REAL
);
