import { describe, expect, it } from "vitest";
import type { ActivityGap, ActivityTrack } from "@/api/adapters";
import { crossingAt, findCrossings, followRoads } from "@/features/activity/crossings";
import type { Trip } from "@/map/layers/makeTripsLayer";

// A ride east along a road: fixes every 10 s, then 100 s without GPS (a tunnel), then on.
// Positions are about 11 m apart per 0.0001° of longitude at 25°N, so the tunnel step
// from 51.50 to 51.51 is roughly 1 km.
const trip: Trip = {
  path: [
    [51.4998, 25.3],
    [51.5, 25.3],
    [51.51, 25.3],
    [51.5102, 25.3],
  ],
  timestamps: [0, 10, 110, 120],
};

function trackWithGapAt(...gapSteps: number[]): ActivityTrack {
  return {
    line: { type: "LineString", coordinates: trip.path },
    sampleIndex: [0, 1, 2, 3],
    gapBefore: trip.path.map((_, k) => gapSteps.includes(k)),
  };
}

const roadGap: ActivityGap = {
  seconds: 100,
  straightM: 1000,
  estimate: {
    // The road bends: east, a little north, then east again, 1.2 km in all.
    path: [
      [51.5, 25.3],
      [51.503, 25.304],
      [51.507, 25.304],
      [51.51, 25.3],
    ],
    lengthM: 1200,
    avgSpeedMps: 12,
    source: { activityId: "1", day: "2026-10-01", name: "Doha Cycling" },
  },
};

describe("findCrossings", () => {
  it("finds the stretch where the watch had no GPS, in activity time", () => {
    const [crossing] = findCrossings(trip, trackWithGapAt(2), [roadGap]);
    expect(crossing?.startS).toBe(10);
    expect(crossing?.endS).toBe(110);
  });

  it("uses the average speed along the known road when there is one", () => {
    const [crossing] = findCrossings(trip, trackWithGapAt(2), [roadGap]);
    expect(crossing?.speedMps).toBe(12);
    expect(crossing?.road).toHaveLength(4);
  });

  it("falls back to the straight line between the fixes when no road is known", () => {
    const [crossing] = findCrossings(trip, trackWithGapAt(2), [{ ...roadGap, estimate: null }]);
    // About 1 km in 100 s, a floor rather than the real speed.
    expect(crossing?.speedMps).toBeGreaterThan(9);
    expect(crossing?.speedMps).toBeLessThan(11);
    expect(crossing?.road).toBeNull();
  });

  it("does not trust an estimate the backend measured for a different stretch", () => {
    const [crossing] = findCrossings(trip, trackWithGapAt(2), [{ ...roadGap, seconds: 40 }]);
    expect(crossing?.road).toBeNull();
    expect(crossing?.speedMps).toBeLessThan(11);
  });

  it("has no crossings on a track with no gaps, or one that does not line up", () => {
    expect(findCrossings(trip, trackWithGapAt(), [])).toEqual([]);
    expect(findCrossings(trip, null, [])).toEqual([]);
    const short: Trip = { path: trip.path.slice(0, 3), timestamps: [0, 10, 110] };
    expect(findCrossings(short, trackWithGapAt(2), [roadGap])).toEqual([]);
  });
});

describe("crossingAt", () => {
  const crossings = findCrossings(trip, trackWithGapAt(2), [roadGap]);

  it("is inside a crossing only between its two fixes", () => {
    expect(crossingAt(crossings, 50)).not.toBeNull();
    expect(crossingAt(crossings, 5)).toBeNull();
    expect(crossingAt(crossings, 115)).toBeNull();
    expect(crossingAt(crossings, 10)).toBeNull();
  });
});

describe("followRoads", () => {
  it("puts the road's own bends into the path, timed by how far along them", () => {
    const crossings = findCrossings(trip, trackWithGapAt(2), [roadGap]);
    const filled = followRoads(trip, crossings);

    // The two fixes either side, plus the road's two bends between them.
    expect(filled.path).toHaveLength(trip.path.length + 2);
    expect(filled.timestamps).toEqual([...filled.timestamps].sort((a, b) => a - b));
    expect(filled.path[2]).toEqual([51.503, 25.304]);
    expect(filled.path[3]).toEqual([51.507, 25.304]);
    // Both bends fall inside the 100 s the gap lasted.
    expect(filled.timestamps[2]).toBeGreaterThan(10);
    expect(filled.timestamps[3]).toBeLessThan(110);
  });

  it("keeps the fixes themselves untouched", () => {
    const crossings = findCrossings(trip, trackWithGapAt(2), [roadGap]);
    const filled = followRoads(trip, crossings);
    expect(filled.path[1]).toEqual(trip.path[1]);
    expect(filled.path[4]).toEqual(trip.path[2]);
  });

  it("leaves a crossing with no known road as a straight line", () => {
    const crossings = findCrossings(trip, trackWithGapAt(2), [{ ...roadGap, estimate: null }]);
    expect(followRoads(trip, crossings)).toBe(trip);
  });
});
