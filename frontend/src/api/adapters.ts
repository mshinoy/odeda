// The one place API payloads become the app's own shapes. Maps and charts consume
// `Activity`, `ActivitySummary`, `ActivityStreams`, `ActivityTrack` and `GymSession`
// only, so a change in the backend's shape is absorbed here and nowhere else.
import type { LineString } from "geojson";
import type { components } from "@/api/schema";
import { activityKind, type ActivityKind } from "@/lib/activityKind";
import { movingSpeed, paceFromSpeed } from "@/lib/format";
import { isRecordingGap, type GpsSample } from "@/lib/recordingGaps";
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
  /** The watch's own average: steps a minute for runs and walks, rpm for rides. */
  avgCadenceSpm: number | null;
  rpe: number | null;
  notes: string | null;
  routeId: number | null;
  gearIds: number[];
  isPrivate: boolean;
  excludedFromStats: boolean;
  /** Marked a race by the owner, or by Garmin's `eventType` where they have not said. */
  race: boolean;
  edited: boolean;
  /** Gym totals; null for activities without exercise data. */
  totalSets: number | null;
  totalReps: number | null;
}

/** A row of the activity list: the summary plus what its card shows beside the numbers. */
export interface ActivityListItem extends ActivitySummary {
  maxSpeedMps: number | null;
  avgPowerW: number | null;
  /** True when there is a route to draw; the route itself comes from `toActivityPreviews`. */
  hasGps: boolean;
  /** Empty when the activity has no zones. */
  hrZones: HrZoneTime[];
  /** A gym session's exercises; empty for anything else. */
  exercises: Exercise[];
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
  /**
   * `gapBefore[k]` is true when the step into coordinate `k` crossed a recording gap (the
   * watch paused and resumed elsewhere), so no line should be drawn into it. Absent means
   * there are none.
   */
  gapBefore?: boolean[];
}

export interface Split {
  km: number;
  seconds: number;
  avgHr: number | null;
}

/** One of the watch's laps; in a structured workout, one step of it. */
export interface Lap {
  index: number;
  /** Where the lap starts on the streams' elapsed-time axis. */
  startS: number | null;
  durationS: number | null;
  distanceM: number | null;
  /** Garmin's step intensity (WARMUP, ACTIVE, REST, ...); null for a manual or auto lap. */
  intensity: string | null;
  /** The workout step this lap belongs to; null for laps run after the workout ended. */
  stepIndex: number | null;
  avgHr: number | null;
  maxHr: number | null;
  avgSpeedMps: number | null;
  /** Steps per minute. */
  avgCadenceSpm: number | null;
}

/** One step of the workout plan an activity followed. Units are Garmin's (see the API). */
export interface PlanStep {
  stepIndex: number;
  intensity: string | null;
  durationType: string | null;
  durationValue: number | null;
  targetType: string | null;
  targetValue: number | null;
  targetLow: number | null;
  targetHigh: number | null;
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

/** A pair of shoes, a bike or a strap, as a list or a select needs it. */
export interface GearItem {
  id: number;
  /** `shoe`, `bike`, `strap` or `other`. */
  kind: string;
  /** Nickname if the owner set one, else brand + model. */
  name: string;
  retired: boolean;
}

/** A clustered route, as the route select needs it. */
export interface RouteOption {
  id: number;
  name: string;
  /** The activity type the cluster was built from; a route select offers its own. */
  activityType: string;
  distanceM: number;
  attempts: number;
}

/** What shape a route is: round a loop, out to a turn and back, or one way. */
export type RouteLayout = Schemas["RouteSummary"]["layout"];

/** A clustered route, as the route list shows it: `RouteOption` plus how it has gone. */
export interface RouteListItem extends RouteOption {
  kind: ActivityKind;
  isLoop: boolean;
  layout: RouteLayout;
  /** True once the user renamed, merged or split it; reclustering leaves it alone. */
  pinned: boolean;
  /** Seconds, over the attempts that count; null when none of them was timed. */
  bestTimeS: number | null;
  medianTimeS: number | null;
  /** For a loop, one lap's times, over the attempts that count; null otherwise. */
  bestLapS: number | null;
  medianLapS: number | null;
  firstDay: string | null;
  lastDay: string | null;
  /** The route's shape, for the list's thumbnail; null for one with too few points. */
  polyline: string | null;
}

/** A route on its own page: what it is, and the geometry the map draws. */
export interface Route {
  id: number;
  name: string;
  activityType: string;
  kind: ActivityKind;
  distanceM: number;
  elevationGainM: number | null;
  isLoop: boolean;
  layout: RouteLayout;
  /** True once the user renamed, merged or split it; reclustering leaves it alone. */
  pinned: boolean;
  /** One lap of it (once round a loop, out and back once), `[lon, lat]` as deck.gl and GeoJSON both want it. */
  path: [number, number][];
}

/** One activity filed on a route, as the attempts table shows it. */
export interface RouteAttempt {
  activityId: string;
  day: string;
  startLocal: string | null;
  name: string | null;
  distanceM: number | null;
  movingTimeS: number | null;
  avgHr: number | null;
  avgSpeedMps: number | null;
  /** Left out of the route's stats by the user. */
  excluded: boolean;
  /** The user filed it on this route by hand, rather than the clusterer matching it. */
  manual: boolean;
  /** Full laps timed, on a loop; null on a route that is not one. */
  laps: number | null;
  /** Each timed lap, in order, start line to start line. */
  lapTimesS: number[];
  bestLapS: number | null;
}

/** A route's headline numbers, over the attempts that count. */
export interface RouteStats {
  bestTimeS: number | null;
  medianTimeS: number | null;
  worstTimeS: number | null;
  /** First counted attempt's time minus the last one's: positive means faster now. */
  improvementS: number | null;
  firstDay: string | null;
  lastDay: string | null;
  /** For a loop: one lap's length, and the laps timed round it; null and 0 otherwise. */
  lapM: number | null;
  laps: number;
  bestLapS: number | null;
  /** The attempt the fastest lap was in, for marking it in the table. */
  bestLapActivityId: string | null;
  bestLapDay: string | null;
  medianLapS: number | null;
}

export interface RouteDetail {
  route: Route;
  attempts: RouteAttempt[];
  /** Attempts not excluded from stats: the ones `stats` describes. */
  countedCount: number;
  stats: RouteStats;
  /** The fastest counted attempt, for marking it in the table. */
  bestActivityId: string | null;
}

/** One stretch of a route, aggregated over every attempt at it. */
export interface RouteSegment {
  index: number;
  startM: number;
  endM: number;
  attempts: number;
  /**
   * Median of (this stretch's speed ÷ that attempt's own average speed). Below 1 is
   * ground you are consistently slower on, whichever day you ran it. Null when no
   * attempt recorded a speed here.
   */
  relativeSpeed: number | null;
  medianSpeedMps: number | null;
  medianHr: number | null;
  medianSeconds: number | null;
  medianGradientPct: number | null;
  /** The slice of the route this stretch covers, `[lon, lat]` as deck.gl wants it. */
  path: [number, number][];
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
  /** True when the user relabelled it: `category` is theirs, not Garmin's. */
  edited: boolean;
  /** What Garmin called it, which is what reverting the relabel brings back. */
  garminCategory: string;
  garminSubCategory: string | null;
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
  /** The watch's laps, in order; empty when none were fetched. */
  laps: Lap[];
  /** The plan the laps followed (the first workout, if a run held several); may be empty. */
  plan: PlanStep[];
  bestEfforts: BestEffort[];
  decouplingPct: number | null;
  efficiencyFactor: number | null;
  route: ActivityRoute | null;
  gear: GearItem[];
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
    avgCadenceSpm: row.avg_cadence_spm,
    rpe: row.rpe,
    notes: row.notes,
    routeId: row.route_id,
    gearIds: parseGearIds(row.gear_ids),
    isPrivate: row.private === 1,
    excludedFromStats: row.excluded_from_stats === 1,
    race: row.race === 1,
    edited: row.override_count > 0,
    totalSets: row.total_sets,
    totalReps: row.total_reps,
  };
}

export function toActivityListItem(row: Schemas["ActivityListRow"]): ActivityListItem {
  return {
    ...toActivitySummary(row),
    maxSpeedMps: row.max_speed_mps,
    avgPowerW: row.avg_power_w,
    hasGps: row.has_gps,
    hrZones: row.hr_zones.map(({ zone, seconds }) => ({ zone, seconds })),
    exercises: row.exercises.map(toExercise),
  };
}

/** Each card's route as a Google encoded polyline, by activity id; absent without GPS. */
export type ActivityPreviews = Readonly<Record<string, string>>;

export function toActivityPreviews(raw: Schemas["ActivityPreviews"]): ActivityPreviews {
  return raw.polylines;
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
    edited: raw.edited,
    garminCategory: raw.garmin_category ?? UNKNOWN_EXERCISE,
    garminSubCategory: raw.garmin_sub_category,
  };
}

// ---------------------------------------------------------------- gear and routes

/** The fields a gear row and an activity's gear have in common. */
type GearFields = Pick<Schemas["GearItem"], "gear_id" | "kind" | "display_name" | "retired">;

function toGearItem(raw: GearFields): GearItem {
  return {
    id: raw.gear_id,
    kind: raw.kind,
    name: raw.display_name,
    retired: raw.retired === 1,
  };
}

/** A gear item with its mileage, for the Gear page's cards. */
export interface GearRecord extends GearItem {
  brand: string | null;
  model: string | null;
  nickname: string | null;
  purchaseDate: string | null;
  notes: string | null;
  /** Mileage the item had before it was tracked here; included in `totalDistanceM`. */
  initialDistanceM: number;
  /** The threshold it is worn against; null means it has no retirement distance. */
  retirementDistanceM: number | null;
  totalDistanceM: number;
  /** Distance of the activities carrying it, without `initialDistanceM`. */
  trackedDistanceM: number;
  movingTimeS: number;
  elevationGainM: number;
  activityCount: number;
  firstUse: string | null;
  lastUse: string | null;
  /** `totalDistanceM` against the threshold; null without one. */
  retirementPct: number | null;
  remainingM: number | null;
  /** `ok`, `warn`, `over` or `retired`, as the backend judges it. */
  state: Schemas["GearItem"]["state"];
  distancePerWeekKm: number | null;
}

function toGearRecord(raw: Schemas["GearItem"]): GearRecord {
  return {
    ...toGearItem(raw),
    brand: raw.brand,
    model: raw.model,
    nickname: raw.nickname,
    purchaseDate: raw.purchase_date,
    notes: raw.notes,
    initialDistanceM: raw.initial_distance_m,
    retirementDistanceM: raw.retirement_distance_m,
    totalDistanceM: raw.total_distance_m,
    trackedDistanceM: raw.tracked_distance_m,
    movingTimeS: raw.moving_time_s,
    elevationGainM: raw.elevation_gain_m,
    activityCount: raw.activity_count,
    firstUse: raw.first_use,
    lastUse: raw.last_use,
    retirementPct: raw.retirement_pct,
    remainingM: raw.remaining_m,
    state: raw.state,
    distancePerWeekKm: raw.distance_per_week_km,
  };
}

/** The gear a newly-synced activity of a type gets, one rule per row. */
export interface GearDefaultRule {
  activityType: string;
  gearId: number;
  name: string;
  kind: string;
}

export interface GearCollection {
  gear: GearRecord[];
  defaults: GearDefaultRule[];
  /** The kinds the backend will accept, so the editor's select is never stale. */
  kinds: string[];
}

export function toGearCollection(raw: Schemas["GearList"]): GearCollection {
  return {
    gear: raw.gear.map(toGearRecord),
    defaults: raw.defaults.map((rule) => ({
      activityType: rule.activity_type,
      gearId: rule.gear_id,
      name: rule.display_name,
      kind: rule.kind,
    })),
    kinds: [...raw.kinds],
  };
}

/** The gear on one activity. It carries how it was attached; nothing shows that yet. */
export function toActivityGear(gear: readonly Schemas["ActivityGear"][]): GearItem[] {
  return gear.map(toGearItem);
}

function toRouteOption(route: Schemas["RouteSummary"]): RouteOption {
  return {
    id: route.route_id,
    name: route.name,
    activityType: route.activity_type,
    distanceM: route.distance_m,
    attempts: route.attempts,
  };
}

export function toRouteOptions(raw: Schemas["RouteList"]): RouteOption[] {
  return raw.routes.map(toRouteOption);
}

function toRouteListItem(route: Schemas["RouteSummary"]): RouteListItem {
  return {
    ...toRouteOption(route),
    kind: activityKind(route.activity_type),
    isLoop: route.is_loop,
    layout: route.layout,
    pinned: route.pinned,
    bestTimeS: route.best_moving_time_s,
    medianTimeS: route.median_moving_time_s,
    bestLapS: route.best_lap_s,
    medianLapS: route.median_lap_s,
    polyline: route.polyline ?? null,
    firstDay: route.first_day,
    lastDay: route.last_day,
  };
}

/** Every route, busiest first — the API's order, which is the order the list wants. */
export function toRouteList(raw: Schemas["RouteList"]): RouteListItem[] {
  return raw.routes.map(toRouteListItem);
}

/** `[lon, lat]` coordinates from two columns, skipping any point that is missing one. */
function toCoordinates(path: Schemas["Polyline"]): [number, number][] {
  const coordinates: [number, number][] = [];
  path.lat.forEach((lat, i) => {
    const lon = path.lon[i];
    if (lon !== undefined) coordinates.push([lon, lat]);
  });
  return coordinates;
}

export function toRouteDetail(raw: Schemas["RouteDetail"]): RouteDetail {
  const route = raw.route;

  return {
    route: {
      id: route.route_id,
      name: route.name,
      activityType: route.activity_type,
      kind: activityKind(route.activity_type),
      distanceM: route.distance_m,
      elevationGainM: route.elevation_gain_m,
      isLoop: route.is_loop,
      layout: route.layout,
      pinned: route.pinned,
      path: toCoordinates(route.points),
    },
    attempts: raw.attempts.map(toRouteAttempt),
    countedCount: raw.counted_count,
    stats: {
      bestTimeS: raw.stats.best_time_s,
      medianTimeS: raw.stats.median_time_s,
      worstTimeS: raw.stats.worst_time_s,
      improvementS: raw.stats.improvement_s,
      firstDay: raw.stats.first_day,
      lastDay: raw.stats.last_day,
      lapM: raw.stats.lap_m,
      laps: raw.stats.laps,
      bestLapS: raw.stats.best_lap_s,
      bestLapActivityId: raw.stats.best_lap_activity_id,
      bestLapDay: raw.stats.best_lap_day,
      medianLapS: raw.stats.median_lap_s,
    },
    bestActivityId: raw.best_attempt?.activity_id ?? null,
  };
}

function toRouteAttempt(raw: Schemas["RouteAttempt"]): RouteAttempt {
  return {
    activityId: raw.activity_id,
    day: raw.day,
    startLocal: raw.start_time_local,
    name: raw.activity_name,
    distanceM: raw.distance_m,
    movingTimeS: raw.moving_time_s,
    avgHr: raw.avg_hr,
    avgSpeedMps: raw.avg_speed_mps,
    excluded: raw.excluded_from_stats === 1,
    manual: raw.assigned === "manual",
    laps: raw.laps,
    lapTimesS: raw.lap_times_s,
    bestLapS: raw.best_lap_s,
  };
}

/** The segment profile, in route order; segments the polyline cannot place are dropped. */
export function toRouteSegments(raw: Schemas["RouteSegments"]): RouteSegment[] {
  return raw.segments
    .map((segment) => ({
      index: segment.seg_index,
      startM: segment.start_m,
      endM: segment.end_m,
      attempts: segment.attempts,
      relativeSpeed: segment.relative_speed,
      medianSpeedMps: segment.median_speed_mps,
      medianHr: segment.median_hr,
      medianSeconds: segment.median_seconds,
      medianGradientPct: segment.median_gradient_pct,
      path: toCoordinates(segment.path),
    }))
    .filter((segment) => segment.path.length >= 2);
}

/** One of the activities on the compare view, as its row and its legend need it. */
export interface ComparedActivity {
  id: string;
  day: string;
  name: string;
  kind: ActivityKind;
  distanceM: number | null;
  movingTimeS: number | null;
  avgHr: number | null;
  avgSpeedMps: number | null;
  elevationGainM: number | null;
}

/** An activity being compared: its headline row, and the same streams its own page uses. */
export interface ComparedAttempt {
  activity: ComparedActivity;
  streams: ActivityStreams;
  /** Null for an activity with no usable GPS; it still has charts. */
  track: ActivityTrack | null;
}

/**
 * The compared activities, in the order the API returns them (the order they were
 * asked for). The streams go through the single-activity adapter, so a compared
 * activity carries the same smoothed pace as it does on its own page.
 */
export function toCompare(raw: Schemas["CompareTracks"]): ComparedAttempt[] {
  return raw.attempts.map((attempt) => {
    const streams = toActivityStreams(attempt.streams);
    return {
      activity: {
        id: attempt.activity.activity_id,
        day: attempt.activity.day,
        name: attempt.activity.activity_name ?? "",
        kind: activityKind(attempt.activity.activity_type),
        distanceM: attempt.activity.distance_m,
        movingTimeS: attempt.activity.moving_time_s,
        avgHr: attempt.activity.avg_hr,
        avgSpeedMps: attempt.activity.avg_speed_mps,
        elevationGainM: attempt.activity.elevation_gain_m,
      },
      streams,
      track: toActivityTrack(streams),
    };
  });
}

// ---------------------------------------------------------------- heatmap

/** One cell of the lifetime heatmap grid, at the API's chosen precision. */
export interface HeatmapCell {
  lon: number;
  lat: number;
  /** Recorded samples that fell in this cell. */
  count: number;
}

export interface Heatmap {
  /** Decimal places the coordinates were snapped to: the grid's fineness. */
  precision: number;
  /** The densest cell's count; 0 when there are no points at all. */
  maxCount: number;
  cells: HeatmapCell[];
}

/** The API's three columns become one object per cell, which is what a deck.gl layer reads. */
export function toHeatmap(raw: Schemas["Heatmap"]): Heatmap {
  const cells: HeatmapCell[] = [];

  raw.count.forEach((count, i) => {
    const lon = raw.lon[i];
    const lat = raw.lat[i];
    if (lon === undefined || lat === undefined) return;
    cells.push({ lon, lat, count });
  });

  return { precision: raw.precision, maxCount: raw.max_count, cells };
}

// ---------------------------------------------------------------- streams and track

/** The rolling window for `smoothSpeedMps`: long enough to calm GPS, short enough for a stride. */
export const SPEED_SMOOTHING_S = 30;

/**
 * The same streams with pace averaged over a longer window. The map, the hover and the
 * playback keep the 30 s default; the one chart of the whole activity uses a minute, so
 * the walk breaks of a run and walk session do not swamp the line. Every column keeps its
 * length, so an index means the same moment in both.
 */
export function withPaceWindow(streams: ActivityStreams, windowS: number): ActivityStreams {
  const smoothSpeedMps = rollingMean(streams.speedMps.map(movingSpeed), streams.elapsedS, windowS);
  return { ...streams, smoothSpeedMps, paceSPerKm: smoothSpeedMps.map(paceFromSpeed) };
}

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

  const gapBefore: boolean[] = [];
  let previous: GpsSample | null = null;

  streams.lat.forEach((lat, i) => {
    const lon = streams.lon[i];
    if (lat == null || lon == null) return;
    const sample: GpsSample = {
      elapsedS: streams.elapsedS[i] ?? 0,
      distanceM: streams.distanceM[i] ?? null,
      lat,
      lon,
    };
    gapBefore.push(previous !== null && isRecordingGap(previous, sample));
    previous = sample;
    coordinates.push([lon, lat]);
    sampleIndex.push(i);
  });

  if (coordinates.length < 2) return null;
  return {
    line: { type: "LineString", coordinates },
    sampleIndex,
    ...(gapBefore.some(Boolean) ? { gapBefore } : {}),
  };
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
    laps: detail.laps.map((l) => ({
      index: l.lap_index,
      startS: l.start_offset_s,
      durationS: l.duration_s,
      distanceM: l.distance_m,
      intensity: l.intensity,
      stepIndex: l.wkt_step_index,
      avgHr: l.avg_hr,
      maxHr: l.max_hr,
      avgSpeedMps: l.avg_speed_mps,
      avgCadenceSpm: l.avg_cadence_spm,
    })),
    plan: detail.workout_steps
      .filter((w) => w.workout_index === (detail.workout_steps[0]?.workout_index ?? 0))
      .map((w) => ({
        stepIndex: w.step_index,
        intensity: w.intensity,
        durationType: w.duration_type,
        durationValue: w.duration_value,
        targetType: w.target_type,
        targetValue: w.target_value,
        targetLow: w.target_low,
        targetHigh: w.target_high,
      })),
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
    gear: toActivityGear(detail.gear),
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

/** Whether a Garmin token cache exists on the server, and how old it is. */
export interface GarminConnection {
  connected: boolean;
  tokenDir: string;
  /** ISO-8601 UTC mtime of the token file; null when not connected. */
  tokensUpdatedAt: string | null;
}

export function toGarminConnection(raw: Schemas["GarminStatus"]): GarminConnection {
  return {
    connected: raw.connected,
    tokenDir: raw.token_dir,
    tokensUpdatedAt: raw.tokens_updated_at,
  };
}

// ---------------------------------------------------------------- recording gaps

/** A guess at the path ridden across a gap, from the rider's own other activities. */
export interface GapEstimate {
  /** `[lon, lat]`, from the last recorded point before the gap to the first after it. */
  path: [number, number][];
  lengthM: number;
  /** Length over the time the gap took: an average, and nothing about the pace inside it. */
  avgSpeedMps: number;
  source: { activityId: string; day: string | null; name: string | null };
}

/** A stretch where the watch paused and resumed somewhere else. */
export interface ActivityGap {
  seconds: number;
  straightM: number;
  estimate: GapEstimate | null;
}

export function toActivityGaps(raw: Schemas["ActivityGaps"]): ActivityGap[] {
  return raw.gaps.map((gap) => {
    const estimate = gap.estimate;
    return {
      seconds: gap.seconds,
      straightM: gap.straight_m,
      estimate:
        estimate === null
          ? null
          : {
              path: estimate.lat.map((lat, i): [number, number] => [estimate.lon[i] ?? 0, lat]),
              lengthM: estimate.length_m,
              avgSpeedMps: estimate.avg_speed_mps,
              source: {
                activityId: estimate.source_activity_id,
                day: estimate.source_day,
                name: estimate.source_name,
              },
            },
    };
  });
}
