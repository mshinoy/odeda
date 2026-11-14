import type { PickingInfo } from "@deck.gl/core";
import { PathLayer } from "@deck.gl/layers";
import { describe, expect, it } from "vitest";
import type { Activity, ActivityStreams, ActivityTrack } from "@/api/adapters";
import { hexToRgba } from "@/design/scales";
import { colorTokens } from "@/design/tokens";
import {
  crossedCount,
  cursorDots,
  cursorPosition,
  makeCursorLayer,
  makeRouteLayer,
  nearestCoordinateIndex,
  pickedStreamIndex,
  ROUTE_LAYER_ID,
  routeBounds,
  routeSegments,
  trackMetricRange,
} from "@/map/layers/makeRouteLayer";

const light = colorTokens.light;
const ramp = light.routeRamp;

// Five samples; sample 2 has no fix, so the track has four coordinates.
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

function streams(overrides: Partial<ActivityStreams> = {}): ActivityStreams {
  const empty = [null, null, null, null, null];
  return {
    length: 5,
    elapsedS: [0, 1, 2, 3, 4],
    distanceM: empty,
    hr: [100, 120, 999, 140, null],
    speedMps: empty,
    smoothSpeedMps: empty,
    paceSPerKm: empty,
    cadenceSpm: empty,
    altitudeM: empty,
    gradientPct: empty,
    lat: [25.0, 25.2, null, 25.1, 25.4],
    lon: [51.0, 51.1, null, 51.3, 51.2],
    ...overrides,
  };
}

function activity(overrides: Partial<Activity> = {}): Activity {
  return {
    summary: {
      id: "a1",
      name: "Morning run",
      type: "running",
      kind: "run",
      day: "2026-09-22",
      startLocal: "2026-09-22T06:10:00",
      distanceM: 1000,
      durationS: 300,
      movingTimeS: 300,
      avgHr: 130,
      maxHr: 140,
      avgSpeedMps: 3.3,
      elevationGainM: 0,
      calories: 80,
      trimp: null,
      trainingEffect: null,
      avgCadenceSpm: null,
      rpe: null,
      notes: null,
      routeId: null,
      gearIds: [],
      isPrivate: false,
      excludedFromStats: false,
      race: false,
      edited: false,
      totalSets: null,
      totalReps: null,
    },
    hasGps: true,
    hrZones: [],
    splits: [],
    laps: [],
    plan: [],
    bestEfforts: [],
    decouplingPct: null,
    efficiencyFactor: null,
    route: null,
    gear: [],
    edits: [],
    streams: streams(),
    track,
    ...overrides,
  };
}

describe("trackMetricRange", () => {
  it("only counts samples on the track", () => {
    // Sample 2 (999) has no fix and sample 4 has no value: the range is over 100, 120, 140.
    expect(trackMetricRange(track, streams().hr)).toEqual([100, 140]);
  });

  it("is null when no sample on the track has a value", () => {
    expect(trackMetricRange(track, [null, null, 5, null, null])).toBeNull();
  });
});

describe("routeSegments", () => {
  const segments = routeSegments(track, streams().hr, light);

  it("makes one segment per pair of consecutive coordinates", () => {
    expect(segments).toHaveLength(3);
    expect(segments[0]?.path).toEqual([
      [51.0, 25.0],
      [51.1, 25.2],
    ]);
    expect(segments[2]?.path).toEqual([
      [51.3, 25.1],
      [51.2, 25.4],
    ]);
  });

  it("carries the stream index of the coordinate each segment ends at", () => {
    expect(segments.map((s) => s.streamIndex)).toEqual([1, 3, 4]);
  });

  it("colours by the value at the segment's end, on the ramp over the track's range", () => {
    // Range [100, 140]: 120 sits at 0.5 (the middle step), 140 at the top.
    const middle = ramp[Math.floor(0.5 * ramp.length)] ?? "";
    const top = ramp.at(-1) ?? "";
    expect(segments[0]?.color).toEqual(hexToRgba(middle));
    expect(segments[1]?.color).toEqual(hexToRgba(top));
  });

  it("uses the muted ink where the value is missing", () => {
    expect(segments[2]?.color).toEqual(hexToRgba(light.inkMuted));
  });

  it("uses the muted ink everywhere when the metric has no data", () => {
    const flat = routeSegments(track, [null, null, null, null, null], light);
    expect(flat.every((s) => s.color.join() === hexToRgba(light.inkMuted).join())).toBe(true);
  });

  it("follows the theme's ramp", () => {
    const dark = routeSegments(track, streams().hr, colorTokens.dark);
    expect(dark[1]?.color).toEqual(hexToRgba(colorTokens.dark.routeRamp.at(-1) ?? ""));
  });
});

describe("nearestCoordinateIndex", () => {
  const sampleIndex = [2, 5, 9, 10];

  it("finds an exact match", () => {
    expect(nearestCoordinateIndex(sampleIndex, 2)).toBe(0);
    expect(nearestCoordinateIndex(sampleIndex, 9)).toBe(2);
    expect(nearestCoordinateIndex(sampleIndex, 10)).toBe(3);
  });

  it("falls back to the nearest sample with a fix", () => {
    expect(nearestCoordinateIndex(sampleIndex, 6)).toBe(1);
    expect(nearestCoordinateIndex(sampleIndex, 8)).toBe(2);
  });

  it("takes the earlier one on a tie", () => {
    expect(nearestCoordinateIndex(sampleIndex, 7)).toBe(1);
  });

  it("clamps before the first and after the last", () => {
    expect(nearestCoordinateIndex(sampleIndex, 0)).toBe(0);
    expect(nearestCoordinateIndex(sampleIndex, 50)).toBe(3);
  });

  it("is null for an empty track", () => {
    expect(nearestCoordinateIndex([], 3)).toBeNull();
  });
});

describe("cursorPosition and cursorDots", () => {
  it("puts the cursor on the hovered sample's coordinate", () => {
    expect(cursorPosition(track, 3)).toEqual([51.3, 25.1]);
  });

  it("uses the nearest fix when the hovered sample has none", () => {
    // Sample 2 has no fix; samples 1 and 3 are equally near, the earlier one wins.
    expect(cursorPosition(track, 2)).toEqual([51.1, 25.2]);
  });

  it("has no dot without hover or for another activity's hover", () => {
    expect(cursorDots(activity(), null)).toEqual([]);
    expect(cursorDots(activity(), { activityId: "other", index: 1 })).toEqual([]);
    expect(cursorDots(activity(), { activityId: "a1", index: 1 })).toEqual([
      { position: [51.1, 25.2] },
    ]);
  });

  it("makes no layer when nothing on this activity is hovered", () => {
    expect(makeCursorLayer({ activity: activity(), hover: null, tokens: light })).toBeNull();
    const other = { activityId: "other", index: 1 };
    expect(makeCursorLayer({ activity: activity(), hover: other, tokens: light })).toBeNull();
  });
});

describe("routeBounds", () => {
  it("is the track's bounding box as [[minLon, minLat], [maxLon, maxLat]]", () => {
    expect(routeBounds(track)).toEqual([
      [51.0, 25.0],
      [51.3, 25.4],
    ]);
  });
});

describe("makeRouteLayer", () => {
  it("is null without a track", () => {
    const indoor = activity({ track: null });
    expect(makeRouteLayer({ activity: indoor, colorBy: "hr", tokens: light, theme: "light" })).toBe(
      null,
    );
  });
});

describe("pickedStreamIndex", () => {
  function pick(layerId: string | null, object: unknown): PickingInfo {
    const layer = layerId === null ? null : new PathLayer({ id: layerId });
    const picked = object !== undefined;
    return { color: null, layer, index: 0, picked, object, x: 0, y: 0, pixelRatio: 1 };
  }

  it("maps a route pick back to its stream index", () => {
    const segment = routeSegments(track, streams().hr, light)[1];
    expect(pickedStreamIndex(pick(ROUTE_LAYER_ID, segment))).toBe(3);
  });

  it("ignores picks on other layers and empty picks", () => {
    expect(pickedStreamIndex(pick("something-else", { streamIndex: 3 }))).toBeNull();
    expect(pickedStreamIndex(pick(null, undefined))).toBeNull();
    expect(pickedStreamIndex(pick(ROUTE_LAYER_ID, undefined))).toBeNull();
  });
});

describe("routeSegments across a recording gap", () => {
  it("draws no segment into a sample that resumed after one", () => {
    const paused: ActivityTrack = { ...track, gapBefore: [false, false, true, false] };
    const segments = routeSegments(paused, streams().hr, light);
    expect(segments.map((s) => s.streamIndex)).toEqual([1, 4]);
  });
});

describe("crossedCount", () => {
  // 100 pieces, the piece k coloured from stream index k + 1.
  const pieces = Array.from({ length: 100 }, (_, k) => ({
    path: [
      [51 + k * 0.001, 25],
      [51 + (k + 1) * 0.001, 25],
    ] as [[number, number], [number, number]],
    color: [0, 0, 0, 255] as [number, number, number, number],
    streamIndex: k + 1,
  }));

  it("shows nothing before the start", () => {
    expect(crossedCount(pieces, 0)).toBe(0);
  });

  it("shows only what has been crossed, in whole chunks", () => {
    // 45 pieces crossed, held back to the last whole chunk of 30.
    expect(crossedCount(pieces, 45)).toBe(30);
    expect(crossedCount(pieces, 29)).toBe(0);
    expect(crossedCount(pieces, 60)).toBe(60);
    expect(crossedCount(pieces, 89)).toBe(60);
  });

  it("shows the whole route once it is done, whatever the chunk", () => {
    expect(crossedCount(pieces, 100)).toBe(100);
    expect(crossedCount(pieces, 5000)).toBe(100);
  });

  it("copes with a route that skips a recording gap", () => {
    const gapped = pieces.filter((piece) => piece.streamIndex < 40 || piece.streamIndex > 60);
    expect(crossedCount(gapped, 50, 1)).toBe(39);
    expect(crossedCount(gapped, 61, 1)).toBe(40);
  });
});
