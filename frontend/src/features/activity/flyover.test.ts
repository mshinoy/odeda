import { describe, expect, it } from "vitest";
import { buildFlyover, cameraAt, sway } from "@/features/activity/flyover";
import { normalise } from "@/map/camera";
import type { Trip } from "@/map/layers/makeTripsLayer";

// About 11 m per step at 25°N: 0.0001° of latitude, or a little more of longitude.
const STEP_DEG = 0.0001;
const SPEED = 100;
// 200 points ten seconds apart is 1990 s; at 100× the swoop to the follow camera is
// capped at 15% of it (298 s), so the follow camera is on from there.
const FOLLOWING_FROM_S = 310;

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

/** The flyover camera, which is never null once the mode is `flyover`. */
function shot(path: ReturnType<typeof flyoverOf>, seconds: number, speed = SPEED) {
  // Without the helicopter's sway, so the shots can be checked against the route.
  const camera = cameraAt(path, "flyover", seconds, speed, { sway: false });
  if (!camera) throw new Error("expected a camera");
  return camera;
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

describe("the follow camera", () => {
  it("faces the direction of travel", () => {
    const east = flyoverOf(line(200, STEP_DEG, 0));
    expect(apart(shot(east, 1000).bearing, 90)).toBeLessThan(2);

    const north = flyoverOf(line(200, 0, STEP_DEG));
    expect(apart(shot(north, 1000).bearing, 0)).toBeLessThan(2);
  });

  it("looks ahead of the point, not at it", () => {
    const east = flyoverOf(line(200, STEP_DEG, 0));
    expect(shot(east, 1000).longitude).toBeGreaterThan(51.5 + 100 * STEP_DEG);
  });

  it("starts turning before a corner and finishes after it", () => {
    // 100 steps east, then 100 steps north.
    const corner = 51.5 + 99 * STEP_DEG;
    const path = [
      ...line(100, STEP_DEG, 0),
      ...line(100, 0, STEP_DEG).map(([, lat]): [number, number] => [corner, lat]),
    ];
    const flyover = flyoverOf(path);
    const before = shot(flyover, 900).bearing;
    const atCorner = shot(flyover, 990).bearing;
    const after = shot(flyover, 1900).bearing;

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
    for (const seconds of [800, 1000, 1500, 1900]) {
      expect(apart(shot(flyover, seconds).bearing, 0)).toBeLessThan(25);
    }
  });

  it("rounds a GPS zigzag into a smoother line than the track itself", () => {
    // Heading east, zigzagging 15 m north and south on alternate points.
    const zigzag = line(200, STEP_DEG, 0).map(([lon, lat], i): [number, number] => [
      lon,
      lat + (i % 2 === 0 ? 0.00015 : -0.00015),
    ]);
    const flyover = flyoverOf(zigzag);
    const lats = [900, 905, 910, 915, 920].map((seconds) => shot(flyover, seconds).latitude);
    const spread = Math.max(...lats) - Math.min(...lats);
    // The track swings 0.0003° (about 33 m) peak to peak; the camera keeps under a third of it.
    expect(spread).toBeLessThan(0.0001);
  });
});

describe("the drone shot", () => {
  it("starts wide over the whole route, tilted, around its centre", () => {
    const flyover = flyoverOf(line(200, STEP_DEG, STEP_DEG / 3));
    const camera = shot(flyover, 0);
    expect(camera.longitude).toBe(flyover.centre[0]);
    expect(camera.latitude).toBe(flyover.centre[1]);
    expect(camera.zoom).toBe(flyover.droneZoom);
    expect(camera.zoom).toBeLessThan(flyover.chaseZoom);
    expect(camera.pitch).toBeGreaterThan(0);
  });

  it("faces the way the rider sets off, and does not turn on the spot", () => {
    const flyover = flyoverOf(line(200, STEP_DEG, 0));
    expect(apart(shot(flyover, 0).bearing, 90)).toBeLessThan(2);
    // Heading east throughout, so the whole swoop keeps facing east.
    for (const seconds of [50, 150, 250, 400]) {
      expect(apart(shot(flyover, seconds).bearing, 90)).toBeLessThan(2);
    }
  });

  it("sits further out over a bigger route", () => {
    const small = flyoverOf(line(200, STEP_DEG, 0));
    const big = flyoverOf(line(200, STEP_DEG * 20, 0));
    expect(big.droneZoom).toBeLessThan(small.droneZoom);
  });
});

describe("the swoop from the drone shot to follow", () => {
  it("has no jump in it: each step moves the view only a little", () => {
    const flyover = flyoverOf(line(200, STEP_DEG, STEP_DEG / 3));
    for (let seconds = 0; seconds < 330; seconds += 5) {
      const a = shot(flyover, seconds);
      const b = shot(flyover, seconds + 5);
      expect(Math.abs(a.zoom - b.zoom)).toBeLessThan(0.15);
      expect(Math.abs(a.pitch - b.pitch)).toBeLessThan(2);
      expect(apart(a.bearing, b.bearing)).toBeLessThan(5);
      expect(Math.abs(a.longitude - b.longitude)).toBeLessThan(0.0005);
    }
  });

  it("comes down to the follow camera's own zoom and tilt", () => {
    const flyover = flyoverOf(line(200, STEP_DEG, 0));
    const camera = shot(flyover, FOLLOWING_FROM_S);
    expect(camera.zoom).toBe(flyover.chaseZoom);
    expect(camera.pitch).toBeGreaterThan(60);
  });
});

describe("timing", () => {
  it("swoops in about the same time on screen at any speed, so a slower replay swoops sooner", () => {
    const flyover = flyoverOf(line(200, STEP_DEG, 0));
    // At 200 s, a 50× replay (a 150 s swoop) is already following; a 100× one is not.
    expect(shot(flyover, 200, 50).zoom).toBe(flyover.chaseZoom);
    expect(shot(flyover, 200, 100).zoom).not.toBe(flyover.chaseZoom);
  });

  it("keeps a short activity's swoop to a share of it", () => {
    const flyover = flyoverOf(line(20, STEP_DEG, 0));
    // 190 s long: following by 30% of the way through at any speed.
    expect(shot(flyover, 190 * 0.3, 200).zoom).toBe(flyover.chaseZoom);
  });

  it("holds the same shot for the same time, whatever came before", () => {
    const flyover = flyoverOf(line(200, STEP_DEG, STEP_DEG / 2));
    const first = shot(flyover, 900);
    shot(flyover, 1900);
    shot(flyover, 10);
    expect(shot(flyover, 900)).toEqual(first);
  });

  it("stays on the track before it starts and after it ends", () => {
    const flyover = flyoverOf(line(200, STEP_DEG, 0));
    expect(shot(flyover, -50)).toEqual(shot(flyover, 0));
    expect(shot(flyover, 99_999)).toEqual(shot(flyover, 1990));
  });
});

describe("map", () => {
  it("leaves the camera to the user", () => {
    expect(cameraAt(flyoverOf(line(200, STEP_DEG, 0)), "map", 100, SPEED)).toBeNull();
  });
});

describe("the helicopter's sway", () => {
  const east = () => flyoverOf(line(200, STEP_DEG, 0));
  const swayed = (f: ReturnType<typeof flyoverOf>, seconds: number, speed = SPEED) => {
    const camera = cameraAt(f, "flyover", seconds, speed);
    if (!camera) throw new Error("expected a camera");
    return camera;
  };

  it("flies low and close: a tighter zoom and a steeper tilt than a plain map", () => {
    const flyover = east();
    expect(flyover.chaseZoom).toBeGreaterThanOrEqual(16.5);
    expect(shot(flyover, 1000).pitch).toBeGreaterThanOrEqual(68);
  });

  it("does not sway during the swoop, so the drone shot is steady", () => {
    const flyover = east();
    for (const seconds of [0, 100, 250]) {
      expect(swayed(flyover, seconds)).toEqual(shot(flyover, seconds));
    }
  });

  it("drifts around the follow shot, but only so far", () => {
    const flyover = east();
    let widest = 0;
    for (let seconds = 800; seconds < 1900; seconds += 7) {
      const base = shot(flyover, seconds);
      const camera = swayed(flyover, seconds);
      widest = Math.max(widest, apart(camera.bearing, base.bearing));
      expect(apart(camera.bearing, base.bearing)).toBeLessThanOrEqual(7.01);
      expect(Math.abs(camera.zoom - base.zoom)).toBeLessThanOrEqual(0.101);
      expect(Math.abs(camera.pitch - base.pitch)).toBeLessThanOrEqual(2.201);
    }
    // It does sway: over a minute of screen time it leans well off the road's heading.
    expect(widest).toBeGreaterThan(3);
  });

  it("moves a little each moment, never in a jerk", () => {
    const flyover = east();
    for (let seconds = 800; seconds < 1800; seconds += 1) {
      const a = swayed(flyover, seconds);
      const b = swayed(flyover, seconds + 1);
      expect(apart(a.bearing, b.bearing)).toBeLessThan(0.5);
      expect(Math.abs(a.zoom - b.zoom)).toBeLessThan(0.01);
    }
  });

  it("sways at the same pace on screen at any replay speed", () => {
    const flyover = east();
    // 10 s of screen time into the follow shot at 100x and at 50x: the same sway.
    const at100 = swayed(flyover, 1000, 100);
    const at50 = swayed(flyover, 500, 50);
    expect(at100.bearing).toBeCloseTo(at50.bearing, 6);
    expect(sway(10).bearing).toBeCloseTo(sway(10).bearing, 9);
  });
});
