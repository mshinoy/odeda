// Hands a flyover camera to the map. Pure over a minimal map interface, so both
// providers share it and it can be tested without a map.
import { FIT_PADDING_PX, type MapBounds, type MapCamera } from "@/map/types";

const RESET_MS = 800;

/** How long the view takes to close about two thirds of the way to where it is headed. */
const EASE_TAU_MS = 150;
/** A target this far from the last one is a scrub or a new mode, not the next frame of a glide. */
const JUMP_METRES = 400;
const JUMP_BEARING_DEG = 90;
const METRES_PER_DEG_LAT = 110_574;
const METRES_PER_DEG_LON_AT_EQUATOR = 111_320;

/** Degrees into [0, 360). */
export function normalise(degrees: number): number {
  return ((degrees % 360) + 360) % 360;
}

/** The turn from `from` to `to` that is under 180°, signed. */
export function shortestTurn(from: number, to: number): number {
  return ((((to - from) % 360) + 540) % 360) - 180;
}

/**
 * One frame of easing from where the view is towards where it should be. Exponential,
 * so it covers the same ground however long the frame took, and the bearing takes the
 * short way round.
 */
export function easeCamera(
  current: MapCamera,
  target: MapCamera,
  dtMs: number,
  tauMs = EASE_TAU_MS,
): MapCamera {
  const k = 1 - Math.exp(-Math.max(dtMs, 0) / tauMs);
  return {
    longitude: current.longitude + (target.longitude - current.longitude) * k,
    latitude: current.latitude + (target.latitude - current.latitude) * k,
    zoom: current.zoom + (target.zoom - current.zoom) * k,
    pitch: current.pitch + (target.pitch - current.pitch) * k,
    bearing: normalise(current.bearing + shortestTurn(current.bearing, target.bearing) * k),
  };
}

/** True when `to` is too far from `from` to be the next frame: a scrub, so snap. */
export function isJump(from: MapCamera, to: MapCamera): boolean {
  const dx =
    (to.longitude - from.longitude) *
    METRES_PER_DEG_LON_AT_EQUATOR *
    Math.cos((from.latitude * Math.PI) / 180);
  const dy = (to.latitude - from.latitude) * METRES_PER_DEG_LAT;
  return (
    Math.hypot(dx, dy) > JUMP_METRES ||
    Math.abs(shortestTurn(from.bearing, to.bearing)) > JUMP_BEARING_DEG
  );
}

/** True once easing has nothing visible left to do, so a paused view stops redrawing. */
export function isSettled(a: MapCamera, b: MapCamera): boolean {
  return (
    Math.abs(a.longitude - b.longitude) < 1e-7 &&
    Math.abs(a.latitude - b.latitude) < 1e-7 &&
    Math.abs(a.zoom - b.zoom) < 1e-3 &&
    Math.abs(a.pitch - b.pitch) < 0.05 &&
    Math.abs(shortestTurn(a.bearing, b.bearing)) < 0.05
  );
}

/** The part of a Mapbox or MapLibre map this needs. */
export interface CameraTarget {
  getCenter(): { lng: number; lat: number };
  getZoom(): number;
  getPitch(): number;
  getBearing(): number;
  jumpTo(options: {
    center: [number, number];
    zoom: number;
    pitch: number;
    bearing: number;
  }): unknown;
  fitBounds(
    bounds: MapBounds,
    options: { padding: number; pitch: number; bearing: number; duration: number },
  ): unknown;
}

/** Where the map's camera is now, so a flyover can glide in from it. */
export function readCamera(map: CameraTarget): MapCamera {
  const centre = map.getCenter();
  return {
    longitude: centre.lng,
    latitude: centre.lat,
    zoom: map.getZoom(),
    pitch: map.getPitch(),
    bearing: normalise(map.getBearing()),
  };
}

/**
 * Puts the map on `camera`. With no camera it does nothing, except on the frame the
 * flyover ends (`wasFlying`): then it settles back to the whole route, flat, north up.
 */
export function applyCamera(
  map: CameraTarget,
  camera: MapCamera | null,
  wasFlying: boolean,
  bounds: MapBounds,
): void {
  if (camera) {
    map.jumpTo({
      center: [camera.longitude, camera.latitude],
      zoom: camera.zoom,
      pitch: camera.pitch,
      bearing: camera.bearing,
    });
  } else if (wasFlying) {
    map.fitBounds(bounds, {
      padding: FIT_PADDING_PX,
      pitch: 0,
      bearing: 0,
      duration: RESET_MS,
    });
  }
}
