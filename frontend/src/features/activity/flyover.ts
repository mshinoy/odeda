// The camera for a 3D flyover of an activity, kept out of the map so it can be tested.
// Everything is a function of the playback clock (`elapsed_s`), never of the previous
// frame, so scrubbing, pausing and replaying all land on the same shot.
import type { ActivityKind } from "@/lib/activityKind";
import type { Trip } from "@/map/layers/makeTripsLayer";
import type { MapCamera } from "@/map/types";

/** `map` is the flat, user-driven map; the others take the camera over. */
export const CAMERA_MODES = ["map", "chase", "orbit"] as const;
export type CameraMode = (typeof CAMERA_MODES)[number];

export const CAMERA_LABELS: Record<CameraMode, string> = {
  map: "Map",
  chase: "Chase camera",
  orbit: "Drone orbit",
};

/** The camera looks this far down the road, so the heading starts turning before a bend. */
const LOOKAHEAD_M = 200;
/** The heading is averaged over this far either side, so a wobbly track does not shake the view. */
const SMOOTHING_M = 250;
/** A track shorter than this has no direction worth following. */
const MIN_TRAVEL_M = 50;

const CHASE_PITCH = 65;
/** The point rides below the middle of the screen, with the road ahead above it. */
const CHASE_AHEAD_M = 60;
const CHASE_ZOOM_RIDE = 15.6;
const CHASE_ZOOM_ON_FOOT = 16.4;

const ORBIT_PITCH = 58;
/** The viewport the orbit zoom is fitted for; the camera does not know the real one. */
const ORBIT_VIEWPORT_PX = 700;
const ORBIT_FIT_MARGIN = 1.4;
/** Tilting hides the far half of the ground, so the orbit sits a little further out. */
const ORBIT_PITCH_ZOOM_OUT = 0.6;
const MIN_ZOOM = 10;
const MAX_ZOOM = 17;

const METRES_PER_DEG_LAT = 110_574;
const METRES_PER_DEG_LON_AT_EQUATOR = 111_320;
const WORLD_METRES_PER_PIXEL_AT_ZOOM_0 = 156_543.03392;

/** A track prepared for the camera: where it goes, how far along, which way it faces. */
export interface Flyover {
  trip: Trip;
  /** Metres travelled at each vertex of the trip. */
  distanceM: number[];
  /** Smoothed direction of travel at each vertex, degrees, continuous (not wrapped). */
  heading: number[];
  centre: [number, number];
  chaseZoom: number;
  orbitZoom: number;
}

/** The camera's data for a trip, or null when there is no track worth flying over. */
export function buildFlyover(trip: Trip, kind: ActivityKind): Flyover | null {
  const { path } = trip;
  if (path.length < 2) return null;

  const distanceM = cumulativeDistance(path);
  if ((distanceM[distanceM.length - 1] ?? 0) < MIN_TRAVEL_M) return null;

  const lons = path.map(([lon]) => lon);
  const lats = path.map(([, lat]) => lat);
  const [minLon, maxLon] = [Math.min(...lons), Math.max(...lons)];
  const [minLat, maxLat] = [Math.min(...lats), Math.max(...lats)];
  const centre: [number, number] = [(minLon + maxLon) / 2, (minLat + maxLat) / 2];

  const widthM = (maxLon - minLon) * metresPerDegLon(centre[1]);
  const heightM = (maxLat - minLat) * METRES_PER_DEG_LAT;
  const extentM = Math.max(widthM, heightM, 200);

  return {
    trip,
    distanceM,
    heading: smoothedHeading(path, distanceM),
    centre,
    chaseZoom: kind === "ride" ? CHASE_ZOOM_RIDE : CHASE_ZOOM_ON_FOOT,
    orbitZoom: orbitZoomFor(extentM, centre[1]),
  };
}

/**
 * The camera at `seconds`, or null for the plain map. Chase rides behind the point
 * looking where it is heading; orbit circles the whole route once, start to finish.
 */
export function cameraAt(flyover: Flyover, mode: CameraMode, seconds: number): MapCamera | null {
  if (mode === "map") return null;

  const { trip, heading } = flyover;
  const { index, fraction } = locate(trip.timestamps, seconds);

  if (mode === "orbit") {
    const start = trip.timestamps[0] ?? 0;
    const end = trip.timestamps[trip.timestamps.length - 1] ?? start;
    const progress = end > start ? clamp((seconds - start) / (end - start), 0, 1) : 0;
    return {
      longitude: flyover.centre[0],
      latitude: flyover.centre[1],
      zoom: flyover.orbitZoom,
      pitch: ORBIT_PITCH,
      bearing: normalise((heading[0] ?? 0) + 360 * progress),
    };
  }

  const here = interpolate(trip.path, index, fraction);
  const facing = interpolate1(heading, index, fraction);
  const ahead = offsetAlong(here, facing, CHASE_AHEAD_M);
  return {
    longitude: ahead[0],
    latitude: ahead[1],
    zoom: flyover.chaseZoom,
    pitch: CHASE_PITCH,
    bearing: normalise(facing),
  };
}

/** Degrees into [0, 360). */
export function normalise(degrees: number): number {
  return ((degrees % 360) + 360) % 360;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

function metresPerDegLon(latitude: number): number {
  return METRES_PER_DEG_LON_AT_EQUATOR * Math.cos((latitude * Math.PI) / 180);
}

function orbitZoomFor(extentM: number, latitude: number): number {
  const metresPerPixel = (extentM * ORBIT_FIT_MARGIN) / ORBIT_VIEWPORT_PX;
  const zoom =
    Math.log2(
      (WORLD_METRES_PER_PIXEL_AT_ZOOM_0 * Math.cos((latitude * Math.PI) / 180)) / metresPerPixel,
    ) - ORBIT_PITCH_ZOOM_OUT;
  return clamp(zoom, MIN_ZOOM, MAX_ZOOM);
}

function stepMetres(a: readonly [number, number], b: readonly [number, number]): number {
  const dx = (b[0] - a[0]) * metresPerDegLon((a[1] + b[1]) / 2);
  const dy = (b[1] - a[1]) * METRES_PER_DEG_LAT;
  return Math.hypot(dx, dy);
}

function cumulativeDistance(path: readonly [number, number][]): number[] {
  const out: number[] = [0];
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    out.push((out[i - 1] ?? 0) + (a && b ? stepMetres(a, b) : 0));
  }
  return out;
}

/** Degrees clockwise from north, from `a` towards `b`. */
function bearingBetween(a: readonly [number, number], b: readonly [number, number]): number {
  const dx = (b[0] - a[0]) * metresPerDegLon((a[1] + b[1]) / 2);
  const dy = (b[1] - a[1]) * METRES_PER_DEG_LAT;
  return (Math.atan2(dx, dy) * 180) / Math.PI;
}

/**
 * Which way the track faces at every vertex: towards the point `LOOKAHEAD_M` further
 * on, made continuous (so 359° to 1° is a 2° turn, not a 358° one), then averaged over
 * `SMOOTHING_M` either side. Distances, not times, so a stop does not spin the camera.
 */
function smoothedHeading(
  path: readonly [number, number][],
  distanceM: readonly number[],
): number[] {
  const raw: number[] = [];
  let j = 0;
  for (let i = 0; i < path.length; i++) {
    const here = path[i];
    const distanceHere = distanceM[i] ?? 0;
    while (j < path.length - 1 && (distanceM[j] ?? 0) - distanceHere < LOOKAHEAD_M) j++;
    const target = path[j];
    const moved = (distanceM[j] ?? 0) - distanceHere;
    // At the very end there is nothing ahead: keep the last heading.
    if (here && target && moved > 0) raw.push(bearingBetween(here, target));
    else raw.push(raw[i - 1] ?? 0);
  }

  // A track that starts parked has no heading yet: borrow the first real one.
  const firstReal = raw.findIndex((_, i) => {
    const here = path[i];
    const target = path[Math.min(i + 1, path.length - 1)];
    return here !== undefined && target !== undefined && stepMetres(here, target) > 0;
  });
  for (let i = 0; i < Math.max(firstReal, 0); i++) raw[i] = raw[firstReal] ?? 0;

  for (let i = 1; i < raw.length; i++) {
    const previous = raw[i - 1] ?? 0;
    const current = raw[i] ?? 0;
    raw[i] = current + 360 * Math.round((previous - current) / 360);
  }

  const out: number[] = [];
  let low = 0;
  let high = 0;
  let sum = 0;
  for (let i = 0; i < raw.length; i++) {
    const at = distanceM[i] ?? 0;
    while (high < raw.length && (distanceM[high] ?? 0) <= at + SMOOTHING_M) sum += raw[high++] ?? 0;
    while ((distanceM[low] ?? 0) < at - SMOOTHING_M) sum -= raw[low++] ?? 0;
    out.push(sum / (high - low));
  }
  return out;
}

/** The last vertex at or before `seconds`, and how far (0 to 1) towards the next one. */
function locate(
  timestamps: readonly number[],
  seconds: number,
): { index: number; fraction: number } {
  const last = timestamps.length - 1;
  if (last < 1 || seconds <= (timestamps[0] ?? 0)) return { index: 0, fraction: 0 };
  if (seconds >= (timestamps[last] ?? 0)) return { index: last, fraction: 0 };

  let lo = 0;
  let hi = last;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if ((timestamps[mid] ?? Infinity) <= seconds) lo = mid;
    else hi = mid - 1;
  }
  const from = timestamps[lo] ?? 0;
  const to = timestamps[lo + 1] ?? from;
  return { index: lo, fraction: to > from ? (seconds - from) / (to - from) : 0 };
}

function interpolate1(values: readonly number[], index: number, fraction: number): number {
  const a = values[index] ?? 0;
  const b = values[index + 1] ?? a;
  return a + (b - a) * fraction;
}

function interpolate(
  path: readonly [number, number][],
  index: number,
  fraction: number,
): [number, number] {
  const a = path[index] ?? [0, 0];
  const b = path[index + 1] ?? a;
  return [a[0] + (b[0] - a[0]) * fraction, a[1] + (b[1] - a[1]) * fraction];
}

/** The point `metres` from `from`, along `bearing` degrees clockwise from north. */
function offsetAlong(
  from: readonly [number, number],
  bearing: number,
  metres: number,
): [number, number] {
  const radians = (bearing * Math.PI) / 180;
  const lat = from[1] + (Math.cos(radians) * metres) / METRES_PER_DEG_LAT;
  const lon = from[0] + (Math.sin(radians) * metres) / metresPerDegLon(from[1]);
  return [lon, lat];
}
