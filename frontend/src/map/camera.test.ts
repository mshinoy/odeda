import { describe, expect, it, vi } from "vitest";
import { applyCamera } from "@/map/camera";
import type { MapBounds, MapCamera } from "@/map/types";

const BOUNDS: MapBounds = [
  [51.4, 25.2],
  [51.6, 25.4],
];
const CAMERA: MapCamera = { longitude: 51.5, latitude: 25.3, zoom: 16, pitch: 65, bearing: 90 };

function fakeMap() {
  return { jumpTo: vi.fn(), fitBounds: vi.fn() };
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
