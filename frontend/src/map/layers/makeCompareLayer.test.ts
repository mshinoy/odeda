import { PathLayer } from "@deck.gl/layers";
import { describe, expect, it } from "vitest";
import type { ComparedAttempt } from "@/api/adapters";
import { colorTokens } from "@/design/tokens";
import {
  COMPARE_LAYER_ID,
  comparedBounds,
  comparedTracks,
  makeCompareLayer,
} from "@/map/layers/makeCompareLayer";

const tokens = colorTokens.light;

function attempt(id: string, coordinates: [number, number][] | null): ComparedAttempt {
  return {
    activity: {
      id,
      day: "2026-09-22",
      name: "Doha Running",
      kind: "run",
      distanceM: 7591,
      movingTimeS: 4784,
      avgHr: 136,
      avgSpeedMps: 1.57,
      elevationGainM: 5,
    },
    streams: {
      length: 0,
      elapsedS: [],
      distanceM: [],
      hr: [],
      speedMps: [],
      smoothSpeedMps: [],
      paceSPerKm: [],
      cadenceSpm: [],
      altitudeM: [],
      gradientPct: [],
      lat: [],
      lon: [],
    },
    track:
      coordinates === null
        ? null
        : { line: { type: "LineString", coordinates }, sampleIndex: coordinates.map((_, i) => i) },
  };
}

const first: [number, number][] = [
  [51.5, 25.3],
  [51.52, 25.32],
];
const second: [number, number][] = [
  [51.49, 25.29],
  [51.53, 25.31],
];

describe("comparedTracks", () => {
  it("gives the nth activity the nth series colour, in the order asked for", () => {
    const tracks = comparedTracks([attempt("a", first), attempt("b", second)], tokens);
    expect(tracks.map((t) => [t.id, t.color])).toEqual([
      ["a", tokens.series[0]],
      ["b", tokens.series[1]],
    ]);
  });

  it("leaves out an activity with no GPS without shifting the others' colours", () => {
    const tracks = comparedTracks([attempt("indoor", null), attempt("b", second)], tokens);
    expect(tracks.map((t) => [t.id, t.color])).toEqual([["b", tokens.series[1]]]);
  });
});

describe("comparedBounds", () => {
  it("is the box every drawn track fits in", () => {
    const tracks = comparedTracks([attempt("a", first), attempt("b", second)], tokens);
    expect(comparedBounds(tracks)).toEqual([
      [51.49, 25.29],
      [51.53, 25.32],
    ]);
  });

  it("is null when nothing has GPS, so the caller can say so instead", () => {
    expect(comparedBounds(comparedTracks([attempt("indoor", null)], tokens))).toBeNull();
  });
});

describe("makeCompareLayer", () => {
  it("draws every track in one layer", () => {
    const tracks = comparedTracks([attempt("a", first), attempt("b", second)], tokens);
    const layer = makeCompareLayer(tracks);
    expect(layer).toBeInstanceOf(PathLayer);
    expect(layer?.id).toBe(COMPARE_LAYER_ID);
    expect(layer?.props.data).toBe(tracks);
  });

  it("is null when there is nothing to draw", () => {
    expect(makeCompareLayer([])).toBeNull();
  });
});
