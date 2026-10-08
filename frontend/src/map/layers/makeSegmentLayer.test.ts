import type { PickingInfo } from "@deck.gl/core";
import { PathLayer } from "@deck.gl/layers";
import { describe, expect, it } from "vitest";
import type { Route, RouteSegment } from "@/api/adapters";
import { hexToRgba } from "@/design/scales";
import { colorTokens } from "@/design/tokens";
import {
  makeRouteOutlineLayer,
  makeSegmentLayer,
  OUTLINE_LAYER_ID,
  pickedSegment,
  SEGMENT_LAYER_ID,
  segmentColor,
  segmentSpeedRange,
} from "@/map/layers/makeSegmentLayer";

const light = colorTokens.light;
const ramp = light.metricRamp;

function segment(overrides: Partial<RouteSegment> = {}): RouteSegment {
  return {
    index: 0,
    startM: 0,
    endM: 200,
    attempts: 12,
    relativeSpeed: 1,
    medianSpeedMps: 2.8,
    medianHr: 140,
    medianSeconds: 71,
    medianGradientPct: 0.4,
    path: [
      [51.5, 25.3],
      [51.51, 25.31],
    ],
    ...overrides,
  };
}

const segments = [
  segment({ index: 0, relativeSpeed: 0.8 }),
  segment({ index: 1, relativeSpeed: 1.0 }),
  segment({ index: 2, relativeSpeed: 1.2 }),
];

describe("segmentSpeedRange", () => {
  it("spans the segments' relative speeds", () => {
    expect(segmentSpeedRange(segments)).toEqual([0.8, 1.2]);
  });

  it("ignores segments no attempt timed", () => {
    expect(segmentSpeedRange([...segments, segment({ index: 3, relativeSpeed: null })])).toEqual([
      0.8, 1.2,
    ]);
  });

  it("is null when nothing was timed, so the colours fall back to neutral", () => {
    expect(segmentSpeedRange([segment({ relativeSpeed: null })])).toBeNull();
  });
});

describe("segmentColor", () => {
  it("puts the slowest ground at the bottom of the ramp and the fastest at the top", () => {
    const range = segmentSpeedRange(segments);
    expect(segmentColor(light, segments[0] ?? segment(), range)).toBe(ramp[0]);
    expect(segmentColor(light, segments[2] ?? segment(), range)).toBe(ramp[ramp.length - 1]);
  });

  it("is neutral for a segment with no relative speed", () => {
    const range = segmentSpeedRange(segments);
    expect(segmentColor(light, segment({ relativeSpeed: null }), range)).toBe(light.inkMuted);
  });

  it("is neutral for every segment when none of them was timed", () => {
    expect(segmentColor(light, segment(), null)).toBe(light.inkMuted);
  });
});

describe("makeSegmentLayer", () => {
  it("draws one path per segment", () => {
    const layer = makeSegmentLayer({ segments, tokens: light, theme: "light" });
    expect(layer).toBeInstanceOf(PathLayer);
    expect(layer?.id).toBe(SEGMENT_LAYER_ID);
    expect(layer?.props.data).toBe(segments);
  });

  it("is null for a route whose segments have not been computed", () => {
    expect(makeSegmentLayer({ segments: [], tokens: light, theme: "light" })).toBeNull();
  });
});

describe("pickedSegment", () => {
  it("returns the segment under the pointer", () => {
    const picked = segments[1] ?? segment();
    expect(pickedSegment(pick(SEGMENT_LAYER_ID, picked))).toBe(picked);
  });

  it("ignores a pick on another layer, or on nothing", () => {
    expect(pickedSegment(pick("activity-route", segments[0]))).toBeNull();
    expect(pickedSegment(pick(SEGMENT_LAYER_ID, undefined))).toBeNull();
  });
});

function pick(layerId: string, object: unknown): PickingInfo {
  return { layer: { id: layerId }, object } as unknown as PickingInfo;
}

describe("makeRouteOutlineLayer", () => {
  const route: Route = {
    id: 67,
    name: "27.7 km route #67",
    activityType: "cycling",
    kind: "ride",
    distanceM: 27700,
    elevationGainM: 40,
    isLoop: false,
    layout: "one_way",
    pinned: false,
    path: [
      [51.5, 25.3],
      [51.52, 25.32],
      [51.54, 25.31],
    ],
  };

  it("draws the whole polyline as one neutral path", () => {
    const layer = makeRouteOutlineLayer(route, light);
    expect(layer.id).toBe(OUTLINE_LAYER_ID);
    expect(layer.props.getPath(route, positionContext())).toBe(route.path);
    expect(layer.props.getColor).toEqual(hexToRgba(light.inkMuted, 90));
  });

  it("is not pickable, so it never steals a segment's hover", () => {
    expect(makeRouteOutlineLayer(route, light).props.pickable).toBe(false);
  });
});

/** deck.gl passes an accessor context alongside the object; ours ignores it. */
function positionContext() {
  return { index: 0, data: [], target: [] };
}
