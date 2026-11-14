// The camera for a 3D flyover of an activity, kept out of the map so it can be tested.
// Everything is a function of the playback clock (`elapsed_s`), never of the previous
// frame, so scrubbing, pausing and replaying all land on the same shot.
import type { ActivityKind } from "@/lib/activityKind";
import type { Trip } from "@/map/layers/makeTripsLayer";
import { normalise, shortestTurn } from "@/map/camera";
import type { MapCamera } from "@/map/types";

/** `map` is the flat, user-driven map; `flyover` takes the camera over. */
export type CameraMode = "map" | "flyover";

/** The camera looks this far down the road, so the heading starts turning before a bend. */
const LOOKAHEAD_M = 200;
/** The heading is averaged over this far either side, so a wobbly track does not shake the view. */
const SMOOTHING_M = 250;
/** The camera's own position is averaged over this far either side of the rider. */
const PATH_SMOOTHING_M = 80;
/** A track shorter than this has no direction worth following. */
const MIN_TRAVEL_M = 50;

const CHASE_PITCH = 68;
/**
 * The point rides below the middle of the screen, with the road ahead above it: this far
 * ahead at `REF_ZOOM`, and half as far for every zoom level closer, so the dot stays put
 * on screen however close the camera is.
 */
const CHASE_AHEAD_M = 60;
const REF_ZOOM = 15.6;
/** Low and close, for the drama of it. */
const CHASE_ZOOM_RIDE = 16.5;
const CHASE_ZOOM_ON_FOOT = 17.2;

/** The helicopter's sway fades in over about this long on screen, once it has swooped in. */
const SWAY_RAMP_WALL_S = 2;

const DRONE_PITCH = 58;
/** The swoop from the drone shot down to the follow camera lasts about this long on screen. */
const SWOOP_WALL_S = 3;
/** A short activity gets a short swoop: never more than this share of it. */
const MAX_SWOOP_SHARE = 0.15;
/** The viewport the drone zoom is fitted for; the camera does not know the real one. */
const DRONE_VIEWPORT_PX = 700;
const DRONE_FIT_MARGIN = 1.4;
/** Tilting hides the far half of the ground, so the drone shot sits a little further out. */
const DRONE_PITCH_ZOOM_OUT = 0.6;
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
  /** Where the chase camera sits at each vertex: the trip, rounded off. */
  cameraPath: [number, number][];
  /** Smoothed direction of travel at each vertex, degrees, continuous (not wrapped). */
  heading: number[];
  centre: [number, number];
  chaseZoom: number;
  droneZoom: number;
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
    cameraPath: smoothedPath(path, distanceM),
    heading: smoothedHeading(path, distanceM),
    centre,
    chaseZoom: kind === "ride" ? CHASE_ZOOM_RIDE : CHASE_ZOOM_ON_FOOT,
    droneZoom: droneZoomFor(extentM, centre[1]),
  };
}

/**
 * The camera at `seconds`, or null for the plain map. A flyover opens on a drone shot
 * high over the whole route, facing the way the rider sets off, and swoops quickly down
 * behind the rider to follow close. `speed` is the replay's: the swoop takes about as
 * long on screen at any speed.
 */
export function cameraAt(
  flyover: Flyover,
  mode: CameraMode,
  seconds: number,
  speed: number,
  { sway: swayOn = true }: { sway?: boolean } = {},
): MapCamera | null {
  if (mode === "map") return null;

  const { timestamps } = flyover.trip;
  const start = timestamps[0] ?? 0;
  const duration = Math.max((timestamps[timestamps.length - 1] ?? start) - start, 0);
  const swoopS = Math.min(SWOOP_WALL_S * speed, duration * MAX_SWOOP_SHARE);
  const elapsed = seconds - start;

  const follow = followCamera(flyover, seconds);
  if (elapsed >= swoopS) {
    if (!swayOn) return follow;
    const amount = smoothstep((elapsed - swoopS) / (SWAY_RAMP_WALL_S * speed));
    return withSway(follow, sway(elapsed / speed), amount);
  }

  const drone: MapCamera = {
    longitude: flyover.centre[0],
    latitude: flyover.centre[1],
    zoom: flyover.droneZoom,
    pitch: DRONE_PITCH,
    bearing: followCamera(flyover, start).bearing,
  };
  const blend = smoothstep(Math.max(elapsed, 0) / swoopS);
  return {
    longitude: drone.longitude + (follow.longitude - drone.longitude) * blend,
    latitude: drone.latitude + (follow.latitude - drone.latitude) * blend,
    zoom: drone.zoom + (follow.zoom - drone.zoom) * blend,
    pitch: drone.pitch + (follow.pitch - drone.pitch) * blend,
    bearing: normalise(drone.bearing + shortestTurn(drone.bearing, follow.bearing) * blend),
  };
}

/**
 * How the helicopter moves, in seconds on screen: a few slow waves of different lengths
 * that never quite line up, so it drifts and corrects like a pilot keeping up, not like a
 * rail. Screen seconds, so it looks the same at 25x as at 200x.
 */
export function sway(screenS: number): {
  bearing: number;
  pitch: number;
  zoom: number;
  sideM: number;
  aheadM: number;
} {
  const wave = (period: number, phase: number) =>
    Math.sin((2 * Math.PI * screenS) / period + phase);
  return {
    bearing: 5 * wave(7.3, 0.4) + 2 * wave(3.1, 1.7),
    pitch: 2.2 * wave(9.1, 2.1),
    zoom: 0.1 * wave(11.7, 0.9),
    sideM: 14 * wave(8.3, 3.0),
    aheadM: 10 * wave(6.1, 0.2),
  };
}

/** The follow camera pushed about by the sway, `amount` (0 to 1) of the way. */
function withSway(follow: MapCamera, s: ReturnType<typeof sway>, amount: number): MapCamera {
  // Metres on the ground matter less the closer the camera is: scale them with the zoom.
  const scale = 2 ** (REF_ZOOM - follow.zoom);
  const side = offsetAlong(
    [follow.longitude, follow.latitude],
    follow.bearing + 90,
    s.sideM * amount * scale,
  );
  const moved = offsetAlong(side, follow.bearing, s.aheadM * amount * scale);
  return {
    longitude: moved[0],
    latitude: moved[1],
    zoom: follow.zoom + s.zoom * amount,
    pitch: follow.pitch + s.pitch * amount,
    bearing: normalise(follow.bearing + s.bearing * amount),
  };
}

/** Close behind the rider, looking where the route is heading. */
function followCamera(flyover: Flyover, seconds: number): MapCamera {
  const { index, fraction } = locate(flyover.trip.timestamps, seconds);
  const here = interpolate(flyover.cameraPath, index, fraction);
  const facing = interpolate1(flyover.heading, index, fraction);
  const ahead = offsetAlong(here, facing, CHASE_AHEAD_M * 2 ** (REF_ZOOM - flyover.chaseZoom));
  return {
    longitude: ahead[0],
    latitude: ahead[1],
    zoom: flyover.chaseZoom,
    pitch: CHASE_PITCH,
    bearing: normalise(facing),
  };
}

/** 0 to 1 with a soft start and finish, so a hand-off has no corner in it. */
function smoothstep(x: number): number {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

function metresPerDegLon(latitude: number): number {
  return METRES_PER_DEG_LON_AT_EQUATOR * Math.cos((latitude * Math.PI) / 180);
}

function droneZoomFor(extentM: number, latitude: number): number {
  const metresPerPixel = (extentM * DRONE_FIT_MARGIN) / DRONE_VIEWPORT_PX;
  const zoom =
    Math.log2(
      (WORLD_METRES_PER_PIXEL_AT_ZOOM_0 * Math.cos((latitude * Math.PI) / 180)) / metresPerPixel,
    ) - DRONE_PITCH_ZOOM_OUT;
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

  return averageOverDistance(raw, distanceM, SMOOTHING_M);
}

/**
 * Each value averaged with its neighbours up to `windowM` metres of track either side.
 * By distance, not by index or time: a stop adds samples without adding ground, and
 * should not drag the average towards where the rider was standing.
 */
function averageOverDistance(
  values: readonly number[],
  distanceM: readonly number[],
  windowM: number,
): number[] {
  const out: number[] = [];
  let low = 0;
  let high = 0;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    const at = distanceM[i] ?? 0;
    while (high < values.length && (distanceM[high] ?? 0) <= at + windowM)
      sum += values[high++] ?? 0;
    while ((distanceM[low] ?? 0) < at - windowM) sum -= values[low++] ?? 0;
    out.push(sum / (high - low));
  }
  return out;
}

/**
 * The route the camera follows: the track with its corners rounded off and the GPS
 * jitter averaged out. The marker still sits on the real track; only the view glides.
 */
function smoothedPath(
  path: readonly [number, number][],
  distanceM: readonly number[],
): [number, number][] {
  const lons = averageOverDistance(
    path.map(([lon]) => lon),
    distanceM,
    PATH_SMOOTHING_M,
  );
  const lats = averageOverDistance(
    path.map(([, lat]) => lat),
    distanceM,
    PATH_SMOOTHING_M,
  );
  return lons.map((lon, i): [number, number] => [lon, lats[i] ?? 0]);
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
