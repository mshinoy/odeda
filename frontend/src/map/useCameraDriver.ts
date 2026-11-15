// Flies a map's camera towards whatever camera it is given, on the display's own
// refresh rather than on React's renders. The playback clock ticks and the camera it
// yields can step; the view eases between those steps, so the flight glides.
import { useEffect, useRef } from "react";
import {
  applyCamera,
  easeCamera,
  isJump,
  isSettled,
  readCamera,
  type CameraTarget,
} from "@/map/camera";
import type { MapBounds, MapCamera } from "@/map/types";

export function useCameraDriver(
  map: CameraTarget | undefined,
  camera: MapCamera | null | undefined,
  bounds: MapBounds,
  exact = false,
): void {
  const target = useRef<MapCamera | null>(null);
  const shown = useRef<MapCamera | null>(null);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    if (!map) return;

    if (!camera) {
      // The flyover ended: stop, and settle back to the route.
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
      applyCamera(map, null, shown.current !== null, bounds);
      shown.current = null;
      target.current = null;
      return;
    }

    if (exact) {
      // Rendering video: every frame is its own shot, so go straight to it.
      shown.current = camera;
      target.current = camera;
      applyCamera(map, camera, true, bounds);
      return;
    }

    if (shown.current === null) {
      // Glide in from wherever the map is, instead of cutting to the first shot.
      shown.current = readCamera(map);
    } else if (target.current && isJump(target.current, camera)) {
      // Scrubbed somewhere else: go there, rather than flying across the route.
      shown.current = camera;
      applyCamera(map, camera, true, bounds);
    }
    target.current = camera;

    if (frame.current !== null) return;
    let last = performance.now();
    const tick = (now: number) => {
      const goal = target.current;
      const here = shown.current;
      if (goal && here && !isSettled(here, goal)) {
        const next = easeCamera(here, goal, now - last);
        shown.current = next;
        applyCamera(map, next, true, bounds);
      }
      last = now;
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  }, [map, camera, bounds, exact]);

  // Only on unmount: the loop outlives the effect above so it survives every new camera.
  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
    },
    [],
  );
}
