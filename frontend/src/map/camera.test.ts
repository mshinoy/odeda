import { describe, expect, it, vi } from "vitest";
import { applyCamera, easeCamera, isJump, isSettled } from "@/map/camera";
import type { MapBounds, MapCamera } from "@/map/types";

const BOUNDS: MapBounds = [
  [51.4, 25.2],
  [51.6, 25.4],
];
const CAMERA: MapCamera = { longitude: 51.5, latitude: 25.3, zoom: 16, pitch: 65, bearing: 90 };

function fakeMap() {
  return {
    jumpTo: vi.fn(),
    fitBounds: vi.fn(),
    getCenter: () => ({ lng: 51.5, lat: 25.3 }),
    getZoom: () => 12,
    getPitch: () => 0,
    getBearing: () => 0,
  };
}

describe("applyCamera", () => {
  it("jumps to the camera", () => {
    const map = fakeMap();
    applyCamera(map, CAMERA, false, BOUNDS);
    expect(map.jumpTo).toHaveBeenCalledWith({
      center: [51.5, 25.3],
      zoom: 16,
      pitch: 65,
      bearing: 90,
    });
    expect(map.fitBounds).not.toHaveBeenCalled();
  });

  it("settles back to the route, flat, when the flyover ends", () => {
    const map = fakeMap();
    applyCamera(map, null, true, BOUNDS);
    expect(map.fitBounds).toHaveBeenCalledWith(
      BOUNDS,
      expect.objectContaining({ pitch: 0, bearing: 0 }),
    );
  });

  it("leaves a map that was never flown alone", () => {
    const map = fakeMap();
    applyCamera(map, null, false, BOUNDS);
    expect(map.jumpTo).not.toHaveBeenCalled();
    expect(map.fitBounds).not.toHaveBeenCalled();
  });
});

describe("easeCamera", () => {
  const FROM: MapCamera = { longitude: 51.5, latitude: 25.3, zoom: 14, pitch: 0, bearing: 350 };
  const TO: MapCamera = { longitude: 51.6, latitude: 25.4, zoom: 16, pitch: 60, bearing: 10 };

  it("moves part of the way, and the same way whatever the frame length", () => {
    const once = easeCamera(FROM, TO, 100);
    expect(once.longitude).toBeGreaterThan(FROM.longitude);
    expect(once.longitude).toBeLessThan(TO.longitude);

    const halves = easeCamera(easeCamera(FROM, TO, 50), TO, 50);
    expect(halves.longitude).toBeCloseTo(once.longitude, 9);
    expect(halves.zoom).toBeCloseTo(once.zoom, 9);
  });

  it("arrives given long enough, and stands still given no time", () => {
    expect(easeCamera(FROM, TO, 5000).latitude).toBeCloseTo(TO.latitude, 6);
    expect(easeCamera(FROM, TO, 0)).toEqual(FROM);
  });

  it("turns the short way round through north", () => {
    const next = easeCamera(FROM, TO, 100);
    // 350° to 10° is a 20° turn through 0°, never 340° back through 180°.
    expect(next.bearing > 350 || next.bearing < 10).toBe(true);
  });
});

describe("isJump", () => {
  it("treats a frame's worth of travel as a glide and a scrub as a jump", () => {
    const next = { ...CAMERA, longitude: CAMERA.longitude + 0.0002 };
    const far = { ...CAMERA, longitude: CAMERA.longitude + 0.05 };
    expect(isJump(CAMERA, next)).toBe(false);
    expect(isJump(CAMERA, far)).toBe(true);
    expect(isJump(CAMERA, { ...CAMERA, bearing: 200 })).toBe(true);
  });

  it("settles once nothing visible is left to ease", () => {
    expect(isSettled(CAMERA, { ...CAMERA, longitude: CAMERA.longitude + 1e-9 })).toBe(true);
    expect(isSettled(CAMERA, { ...CAMERA, zoom: CAMERA.zoom + 1 })).toBe(false);
  });
});
