// Hands a flyover camera to the map. Pure over a minimal map interface, so both
// providers share it and it can be tested without a map.
import { FIT_PADDING_PX, type MapBounds, type MapCamera } from "@/map/types";

const RESET_MS = 800;

/** The part of a Mapbox or MapLibre map this needs. */
export interface CameraTarget {
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
