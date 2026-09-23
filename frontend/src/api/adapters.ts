// The one place API payloads become the app's own shapes. Maps and charts consume
// `Activity`, `ActivitySummary`, `ActivityStreams` and `ActivityTrack` only, so a change
// in the backend's shape is absorbed here and nowhere else.
import type { LineString } from "geojson";
import type { components } from "@/api/schema";
import { activityKind, type ActivityKind } from "@/lib/activityKind";
import { paceFromSpeed } from "@/lib/format";

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
  /** Seconds per km; null when standing still or speed is missing. */
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
  overrides: Schemas["Override"][];
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

// ---------------------------------------------------------------- streams and track

export function toActivityStreams(raw: Schemas["ActivityStreams"]): ActivityStreams {
  return {
    length: raw.elapsed_s.length,
    elapsedS: raw.elapsed_s,
    distanceM: raw.distance_m,
    hr: raw.hr,
    speedMps: raw.speed_mps,
    paceSPerKm: raw.speed_mps.map(paceFromSpeed),
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
    overrides: detail.overrides,
    streams,
    track,
  };
}
