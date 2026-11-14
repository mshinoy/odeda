import { describe, expect, it } from "vitest";
import { buildFlyover, cameraAt } from "@/features/activity/flyover";
import { normalise } from "@/map/camera";
import type { Trip } from "@/map/layers/makeTripsLayer";

// About 11 m per step at 25°N: 0.0001° of latitude, or a little more of longitude.
const STEP_DEG = 0.0001;

function tripOf(path: [number, number][]): Trip {
  return { path, timestamps: path.map((_, i) => i * 10) };
}

function line(count: number, dLon: number, dLat: number): [number, number][] {
  return Array.from({ length: count }, (_, i): [number, number] => [
    51.5 + i * dLon,
    25.3 + i * dLat,
  ]);
}

/** Smallest angle between two bearings, in degrees. */
function apart(a: number, b: number): number {
  const diff = Math.abs(normalise(a) - normalise(b));
  return Math.min(diff, 360 - diff);
}

function flyoverOf(path: [number, number][]) {
  const flyover = buildFlyover(tripOf(path), "ride");
  if (!flyover) throw new Error("expected a flyover");
  return flyover;
}

describe("buildFlyover", () => {
  it("has nothing to follow on a single point or a parked track", () => {
    expect(buildFlyover(tripOf([[51.5, 25.3]]), "run")).toBeNull();
    expect(buildFlyover(tripOf(Array.from({ length: 20 }, () => [51.5, 25.3])), "run")).toBeNull();
  });

  it("rides out wider than it runs", () => {
    const path = line(200, STEP_DEG, 0);
    const ride = buildFlyover(tripOf(path), "ride");
    const run = buildFlyover(tripOf(path), "run");
    expect(ride?.chaseZoom).toBeLessThan(run?.chaseZoom ?? 0);
  });
});

describe("chase camera", () => {
  it("faces the direction of travel", () => {
    const east = flyoverOf(line(200, STEP_DEG, 0));
    expect(apart(cameraAt(east, "chase", 1000)?.bearing ?? -999, 90)).toBeLessThan(2);

    const north = flyoverOf(line(200, 0, STEP_DEG));
    expect(apart(cameraAt(north, "chase", 1000)?.bearing ?? -999, 0)).toBeLessThan(2);
  });

  it("looks ahead of the point, not at it", () => {
    const east = flyoverOf(line(200, STEP_DEG, 0));
    const camera = cameraAt(east, "chase", 1000);
    const here = 51.5 + 100 * STEP_DEG;
    expect(camera?.longitude).toBeGreaterThan(here);
  });

  it("starts turning before a corner and finishes after it", () => {
    // 100 steps east, then 100 steps north.
    const corner = 51.5 + 99 * STEP_DEG;
    const path = [
      ...line(100, STEP_DEG, 0),
      ...line(100, 0, STEP_DEG).map(([, lat]): [number, number] => [corner, lat]),
    ];
    const flyover = flyoverOf(path);
    const before = cameraAt(flyover, "chase", 90 * 10)?.bearing ?? -999;
    const atCorner = cameraAt(flyover, "chase", 99 * 10)?.bearing ?? -999;
    const after = cameraAt(flyover, "chase", 190 * 10)?.bearing ?? -999;

    expect(before).toBeGreaterThan(40);
    expect(before).toBeLessThan(90);
    expect(atCorner).toBeGreaterThan(10);
    expect(atCorner).toBeLessThan(80);
    expect(apart(after, 0)).toBeLessThan(5);
  });

  it("does not spin through south when the heading wobbles across north", () => {
    // Heading north with a sideways jitter: raw bearings alternate near 0° and 360°.
    const path = line(200, 0, STEP_DEG).map(([lon, lat], i): [number, number] => [
      lon + (i % 2 === 0 ? 0.00002 : -0.00002),
      lat,
    ]);
    const flyover = flyoverOf(path);
    for (const seconds of [200, 600, 1000, 1500]) {
      expect(apart(cameraAt(flyover, "chase", seconds)?.bearing ?? -999, 0)).toBeLessThan(25);
    }
  });

  it("holds the same shot for the same time, whatever came before", () => {
    const flyover = flyoverOf(line(200, STEP_DEG, STEP_DEG / 2));
    const first = cameraAt(flyover, "chase", 700);
    cameraAt(flyover, "chase", 1900);
    cameraAt(flyover, "chase", 10);
    expect(cameraAt(flyover, "chase", 700)).toEqual(first);
  });

  it("stays on the track before it starts and after it ends", () => {
    const flyover = flyoverOf(line(200, STEP_DEG, 0));
    const early = cameraAt(flyover, "chase", -50);
    const start = cameraAt(flyover, "chase", 0);
    const late = cameraAt(flyover, "chase", 99_999);
    const end = cameraAt(flyover, "chase", 1990);
    expect(early).toEqual(start);
    expect(late).toEqual(end);
  });
});

describe("drone orbit", () => {
  it("circles the whole route once, start to finish, around its centre", () => {
    const flyover = flyoverOf(line(200, STEP_DEG, STEP_DEG / 3));
    const start = cameraAt(flyover, "orbit", 0);
    const half = cameraAt(flyover, "orbit", 995);
    const end = cameraAt(flyover, "orbit", 1990);

    expect(apart(half?.bearing ?? -999, (start?.bearing ?? 0) + 180)).toBeLessThan(2);
    expect(apart(end?.bearing ?? -999, start?.bearing ?? 0)).toBeLessThan(0.5);
    expect(start?.longitude).toBe(flyover.centre[0]);
    expect(start?.latitude).toBe(flyover.centre[1]);
    expect(end?.zoom).toBe(start?.zoom);
  });

  it("sits further out over a bigger route", () => {
    const small = flyoverOf(line(200, STEP_DEG, 0));
    const big = flyoverOf(line(200, STEP_DEG * 20, 0));
    expect(big.orbitZoom).toBeLessThan(small.orbitZoom);
  });
});

describe("map", () => {
  it("leaves the camera to the user", () => {
    expect(cameraAt(flyoverOf(line(200, STEP_DEG, 0)), "map", 100)).toBeNull();
  });
});

describe("camera path", () => {
  it("rounds a GPS zigzag into a smoother line than the track itself", () => {
    // Heading east, zigzagging 15 m north and south on alternate points.
    const zigzag = line(200, STEP_DEG, 0).map(([lon, lat], i): [number, number] => [
      lon,
      lat + (i % 2 === 0 ? 0.00015 : -0.00015),
    ]);
    const flyover = flyoverOf(zigzag);
    const lats = [900, 905, 910, 915, 920].map(
      (seconds) => cameraAt(flyover, "chase", seconds)?.latitude ?? 0,
    );
    const spread = Math.max(...lats) - Math.min(...lats);
    // The track swings 0.0003° (about 33 m) peak to peak; the camera keeps under a third of it.
    expect(spread).toBeLessThan(0.0001);
  });
});
