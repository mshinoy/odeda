// The one place API payloads become the app's own shapes. Maps and charts consume
// `Activity`, `ActivitySummary`, `ActivityStreams`, `ActivityTrack` and `GymSession`
// only, so a change in the backend's shape is absorbed here and nowhere else.
import type { LineString } from "geojson";
import type { components } from "@/api/schema";
import { activityKind, type ActivityKind } from "@/lib/activityKind";
import { movingSpeed, paceFromSpeed } from "@/lib/format";
import { rollingMean } from "@/lib/smoothing";

type Schemas = components["schemas"];

/** What a list row, a card or a map legend needs to know about an activity. */
export interface ActivitySummary {
  id: string;
  name: string;
  type: string;
  kind: ActivityKind;
  day: string;
  startLocal: string;
  distanceM: number | null;
  durationS: number | null;
  movingTimeS: number | null;
  avgHr: number | null;
  maxHr: number | null;
  avgSpeedMps: number | null;
  elevationGainM: number | null;
  calories: number | null;
  trimp: number | null;
  trainingEffect: number | null;
  rpe: number | null;
  notes: string | null;
  routeId: number | null;
  gearIds: number[];
  isPrivate: boolean;
  excludedFromStats: boolean;
  edited: boolean;
  /** Gym totals; null for activities without exercise data. */
  totalSets: number | null;
  totalReps: number | null;
}

/**
 * One column per channel, all the same length, one entry per recorded sample.
 * Index `i` is the same moment in every column, and the index the map and the charts
 * share for hover (see `useUiStore().hover`).
 */
export interface ActivityStreams {
  length: number;
  elapsedS: number[];
  distanceM: (number | null)[];
  hr: (number | null)[];
  speedMps: (number | null)[];
  /**
   * Speed averaged over ~30 s (`SPEED_SMOOTHING_S`), null when standing still. GPS speed
   * jitters from second to second; the pace line and the route colour read this one.
   */
  smoothSpeedMps: (number | null)[];
  /** Seconds per km from `smoothSpeedMps`; null when standing still or speed is missing. */
  paceSPerKm: (number | null)[];
  cadenceSpm: (number | null)[];
  altitudeM: (number | null)[];
  /** Percent grade between this sample and the previous one; null without altitude or distance. */
  gradientPct: (number | null)[];
  lat: (number | null)[];
  lon: (number | null)[];
}

/**
 * The GPS part of the streams as GeoJSON. Coordinates are [lon, lat] (GeoJSON order).
 * `sampleIndex[k]` is the stream index of coordinate `k`, since samples without a fix
 * (tunnels, the first seconds) have no coordinate.
 */
export interface ActivityTrack {
  line: LineString;
  sampleIndex: number[];
}

export interface Split {
  km: number;
  seconds: number;
  avgHr: number | null;
}

export interface BestEffort {
  label: string | null;
  distanceM: number;
  seconds: number;
}

export interface HrZoneTime {
  zone: number;
  seconds: number;
}

export interface ActivityRoute {
  id: number;
  name: string;
  matchScore: number | null;
  manual: boolean;
}

/** Garmin's category for an exercise it could not name. */
export const UNKNOWN_EXERCISE = "UNKNOWN";

/** One exercise summed over its sets (Garmin has no per-set detail). */
export interface Exercise {
  /** Position in Garmin's payload; relabels key on it. */
  index: number;
  /** Garmin's category, e.g. `BENCH_PRESS`; `UNKNOWN_EXERCISE` when it has none. */
  category: string;
  /** The variant, e.g. `ROMANIAN_DEADLIFT`, when Garmin names one. */
  subCategory: string | null;
  sets: number | null;
  reps: number | null;
  /** Heaviest weight, grams; null for bodyweight work. */
  maxWeightG: number | null;
  /** Weight x reps summed over the sets, grams. */
  volumeG: number | null;
  durationMs: number | null;
}

/** The gym part of an activity. `exercises` is empty when there is no exercise data. */
export interface GymSession {
  totalSets: number | null;
  activeSets: number | null;
  totalReps: number | null;
  exercises: Exercise[];
}

/** An activity with everything the single-activity view shows. */
export interface Activity {
  summary: ActivitySummary;
  hasGps: boolean;
  hrZones: HrZoneTime[];
  splits: Split[];
  bestEfforts: BestEffort[];
  decouplingPct: number | null;
  efficiencyFactor: number | null;
  route: ActivityRoute | null;
  gear: Schemas["ActivityGear"][];
  /** The fields the user has edited, in field order. */
  edits: FieldEdit[];
  streams: ActivityStreams;
  /** Null for indoor activities. */
  track: ActivityTrack | null;
}

// ---------------------------------------------------------------- summaries

export function toActivitySummary(row: Schemas["ActivityRow"]): ActivitySummary {
  return {
    id: row.activity_id,
    name: row.activity_name ?? "",
    type: row.activity_type,
    kind: activityKind(row.activity_type),
    day: row.day,
    startLocal: row.start_time_local,
    distanceM: row.distance_m,
    durationS: row.duration_s,
    movingTimeS: row.moving_time_s,
    avgHr: row.avg_hr,
    maxHr: row.max_hr,
    avgSpeedMps: row.avg_speed_mps,
    elevationGainM: row.elevation_gain_m,
    calories: row.calories,
    trimp: row.trimp,
    trainingEffect: row.training_effect_aerobic,
    rpe: row.rpe,
    notes: row.notes,
    routeId: row.route_id,
    gearIds: parseGearIds(row.gear_ids),
    isPrivate: row.private === 1,
    excludedFromStats: row.excluded_from_stats === 1,
    edited: row.override_count > 0,
    totalSets: row.total_sets,
    totalReps: row.total_reps,
  };
}

/** `gear_ids` comes from SQLite's group_concat: "3,7" or null. */
function parseGearIds(value: string | null): number[] {
  if (value === null || value === "") return [];
  return value
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((id) => Number.isInteger(id));
}

// ---------------------------------------------------------------- gym

export function toGymSession(raw: Schemas["ActivityExercises"]): GymSession {
  return {
    totalSets: raw.total_sets,
    activeSets: raw.active_sets,
    totalReps: raw.total_reps,
    exercises: raw.exercises.map(toExercise),
  };
}

function toExercise(raw: Schemas["Exercise"]): Exercise {
  return {
    index: raw.index,
    // A missing category and Garmin's UNKNOWN mean the same thing: unlabelled.
    category: raw.category ?? UNKNOWN_EXERCISE,
    subCategory: raw.sub_category,
    sets: raw.sets,
    reps: raw.reps,
    maxWeightG: raw.max_weight_g,
    volumeG: raw.volume_g,
    durationMs: raw.duration_ms,
  };
}

// ---------------------------------------------------------------- streams and track

/** The rolling window for `smoothSpeedMps`: long enough to calm GPS, short enough for a stride. */
export const SPEED_SMOOTHING_S = 30;

export function toActivityStreams(raw: Schemas["ActivityStreams"]): ActivityStreams {
  // Stops are left out of the mean, so the line near a traffic light shows the pace
  // you ran at, not a slow blend of running and standing.
  const smoothSpeedMps = rollingMean(
    raw.speed_mps.map(movingSpeed),
    raw.elapsed_s,
    SPEED_SMOOTHING_S,
  );
  return {
    length: raw.elapsed_s.length,
    elapsedS: raw.elapsed_s,
    distanceM: raw.distance_m,
    hr: raw.hr,
    speedMps: raw.speed_mps,
    smoothSpeedMps,
    paceSPerKm: smoothSpeedMps.map(paceFromSpeed),
    cadenceSpm: raw.cadence_spm,
    altitudeM: raw.altitude_m,
    gradientPct: gradients(raw.altitude_m, raw.distance_m),
    lat: raw.lat,
    lon: raw.lon,
  };
}

// Below this horizontal distance a grade is mostly GPS/barometer noise.
const MIN_RUN_FOR_GRADIENT_M = 1;

function gradients(altitudeM: (number | null)[], distanceM: (number | null)[]): (number | null)[] {
  return altitudeM.map((altitude, i) => {
    if (i === 0) return null;
    const prevAltitude = altitudeM[i - 1];
    const distance = distanceM[i];
    const prevDistance = distanceM[i - 1];
    if (altitude == null || prevAltitude == null || distance == null || prevDistance == null) {
      return null;
    }
    const run = distance - prevDistance;
    if (run < MIN_RUN_FOR_GRADIENT_M) return null;
    return ((altitude - prevAltitude) / run) * 100;
  });
}

/** The GPS samples as a GeoJSON line; null when fewer than two samples have a fix. */
export function toActivityTrack(streams: ActivityStreams): ActivityTrack | null {
  const coordinates: [number, number][] = [];
  const sampleIndex: number[] = [];

  streams.lat.forEach((lat, i) => {
    const lon = streams.lon[i];
    if (lat == null || lon == null) return;
    coordinates.push([lon, lat]);
    sampleIndex.push(i);
  });

  if (coordinates.length < 2) return null;
  return { line: { type: "LineString", coordinates }, sampleIndex };
}

// ---------------------------------------------------------------- the full activity

/** Joins the detail with streams already adapted by `toActivityStreams`/`toActivityTrack`. */
export function toActivity(
  detail: Schemas["ActivityDetail"],
  streams: ActivityStreams,
  track: ActivityTrack | null,
): Activity {
  return {
    summary: toActivitySummary(detail.activity),
    hasGps: detail.has_gps,
    hrZones: detail.hr_zones.map((z) => ({ zone: z.zone, seconds: z.seconds })),
    splits: detail.km_splits.map((s) => ({ km: s.km, seconds: s.seconds, avgHr: s.avg_hr })),
    bestEfforts: detail.best_efforts.map((b) => ({
      label: b.label,
      distanceM: b.distance_m,
      seconds: b.seconds,
    })),
    decouplingPct: detail.decoupling_pct,
    efficiencyFactor: detail.efficiency_factor,
    route: detail.route
      ? {
          id: detail.route.route_id,
          name: detail.route.name,
          matchScore: detail.route.match_score,
          manual: detail.route.assigned === "manual",
        }
      : null,
    gear: detail.gear,
    edits: toFieldEdits(detail.overrides),
    streams,
    track,
  };
}

// ---------------------------------------------------------------- editing

/** One user-editable field, from the registry in `db/fields.py` (`GET /api/fields`). */
export interface EditableField {
  name: string;
  label: string;
  /** How the value is stored: `bool` fields arrive as 0/1, `int` and `real` as numbers. */
  type: Schemas["EditableFieldInfo"]["type"];
  editor: Schemas["EditableFieldInfo"]["editor"];
  /** For `select`: the offered values, which are not always a closed set. */
  choices: string[];
  min: number | null;
  max: number | null;
  /** Garmin never supplies it (notes, RPE, ...): reverting clears it. */
  userOnly: boolean;
}

export function toEditableFields(raw: Schemas["FieldsResponse"]): EditableField[] {
  return raw.fields.map((field) => ({
    name: field.name,
    label: field.label,
    type: field.type,
    editor: field.editor,
    choices: field.choices ?? [],
    min: field.min,
    max: field.max,
    userOnly: field.user_only,
  }));
}

/** A field's current value, edits included. Null when neither Garmin nor the user set it. */
export type EditableValue = string | number | boolean | null;

/**
 * Each field's current value on an activity, read from the row by the field's own
 * name: the registry names are the row's column names, so a field added to
 * `db/fields.py` needs no change here. A bool field's 0/1 becomes a boolean.
 */
export function toEditableValues(
  row: Schemas["ActivityRow"],
  fields: readonly EditableField[],
): Record<string, EditableValue> {
  const columns = new Map<string, unknown>(Object.entries(row));
  const values: Record<string, EditableValue> = {};
  for (const field of fields) {
    const value = columns.get(field.name);
    if (field.type === "bool") values[field.name] = value === 1 || value === true;
    else if (typeof value === "string" || typeof value === "number") values[field.name] = value;
    else values[field.name] = null;
  }
  return values;
}

/** One edited field, and what Garmin says for it now (what a revert brings back). */
export interface FieldEdit {
  field: string;
  label: string;
  /** Null for user-only fields, and when Garmin has no value. */
  garminValue: string | number | null;
}

export function toFieldEdits(overrides: readonly Schemas["Override"][]): FieldEdit[] {
  return overrides.map((o) => ({
    field: o.field,
    label: o.label,
    garminValue: o.current_garmin_value,
  }));
}
