import { TripsLayer } from "@deck.gl/geo-layers";
import { describe, expect, it } from "vitest";
import type { ActivityTrack } from "@/api/adapters";
import { hexToRgba } from "@/design/scales";
import { colorTokens } from "@/design/tokens";
import {
  makeTripsLayer,
  toTrip,
  tripPositionAt,
  TRAIL_LENGTH_S,
  TRIPS_LAYER_ID,
  type Trip,
} from "@/map/layers/makeTripsLayer";

const light = colorTokens.light;

// Four coordinates from five samples: sample 2 had no fix.
const track: ActivityTrack = {
  line: {
    type: "LineString",
    coordinates: [
      [51.0, 25.0],
      [51.1, 25.2],
      [51.3, 25.1],
      [51.2, 25.4],
    ],
  },
  sampleIndex: [0, 1, 3, 4],
};

describe("toTrip", () => {
  it("times each coordinate by the sample it came from, not by its position", () => {
    expect(toTrip(track, [0, 10, 20, 30, 40])).toEqual({
      path: [
        [51.0, 25.0],
        [51.1, 25.2],
        [51.3, 25.1],
        [51.2, 25.4],
      ],
      timestamps: [0, 10, 30, 40],
    });
  });

  it("drops a coordinate whose sample has no time rather than guessing one", () => {
    expect(toTrip(track, [0, 10]).timestamps).toEqual([0, 10]);
  });

  it("is empty for a track with no coordinates", () => {
    expect(toTrip({ line: { type: "LineString", coordinates: [] }, sampleIndex: [] }, [])).toEqual({
      path: [],
      timestamps: [],
    });
  });
});

describe("makeTripsLayer", () => {
  const trips: Trip[] = [toTrip(track, [0, 10, 20, 30, 40])];

  it("draws the trail at the given time, in the activity kind's colour", () => {
    const layer = makeTripsLayer({ trips, currentTime: 25, kind: "run", tokens: light });
    expect(layer).toBeInstanceOf(TripsLayer);
    expect(layer?.id).toBe(TRIPS_LAYER_ID);
    expect(layer?.props.currentTime).toBe(25);
    expect(layer?.props.trailLength).toBe(TRAIL_LENGTH_S);
    expect(layer?.props.getColor).toEqual(hexToRgba(light.kind.run));
  });

  it("colours a ride with the ride colour", () => {
    const layer = makeTripsLayer({ trips, currentTime: 0, kind: "ride", tokens: light });
    expect(layer?.props.getColor).toEqual(hexToRgba(light.kind.ride));
  });

  it("hands deck.gl the array it was given, so a frame does not re-upload the path", () => {
    const layer = makeTripsLayer({ trips, currentTime: 0, kind: "run", tokens: light });
    expect(layer?.props.data).toBe(trips);
  });

  it("is null for a track with nothing to draw a trail along, and for no track at all", () => {
    const empty: Trip = { path: [[51, 25]], timestamps: [0] };
    const options = { currentTime: 0, kind: "run" as const, tokens: light };
    expect(makeTripsLayer({ trips: [empty], ...options })).toBeNull();
    expect(makeTripsLayer({ trips: [], ...options })).toBeNull();
  });
});

describe("tripPositionAt", () => {
  const trip: Trip = {
    path: [
      [51.0, 25.0],
      [51.2, 25.4],
      [51.4, 25.0],
    ],
    timestamps: [0, 10, 30],
  };

  it("sits between samples, where the trail's head is, not on the last one", () => {
    const [lon, lat] = tripPositionAt(trip, 5) ?? [0, 0];
    expect(lon).toBeCloseTo(51.1, 9);
    expect(lat).toBeCloseTo(25.2, 9);
    const [lon2] = tripPositionAt(trip, 20) ?? [0, 0];
    expect(lon2).toBeCloseTo(51.3, 9);
  });

  it("moves a little every moment, not once per sample", () => {
    const a = tripPositionAt(trip, 11)?.[0] ?? 0;
    const b = tripPositionAt(trip, 12)?.[0] ?? 0;
    expect(b).toBeGreaterThan(a);
  });

  it("holds the ends before the start and after the finish", () => {
    expect(tripPositionAt(trip, -5)).toEqual([51.0, 25.0]);
    expect(tripPositionAt(trip, 999)).toEqual([51.4, 25.0]);
  });

  it("has nowhere to be on an empty trip", () => {
    expect(tripPositionAt({ path: [], timestamps: [] }, 5)).toBeNull();
  });
});
