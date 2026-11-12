// A route's segments as one coloured path each: where you speed up and where you slow
// down. The range, the colours and the picking are exported on their own so they can be
// tested without deck.gl.
import type { PickingInfo } from "@deck.gl/core";
import { PathLayer } from "@deck.gl/layers";
import type { Route, RouteSegment } from "@/api/adapters";
import { hexToRgba, routeColor, normalize, percentileRange } from "@/design/scales";
import type { ColorTokens, Theme } from "@/design/tokens";

export const SEGMENT_LAYER_ID = "route-segments";
export const OUTLINE_LAYER_ID = "route-outline";

const SEGMENT_WIDTH_PX = 6;
const OUTLINE_WIDTH_PX = 2;
const OUTLINE_ALPHA = 90;

/**
 * The relative speeds the colours span: percentiles over the segments, so one junction
 * where you stop dead does not flatten the rest of the route into a single shade.
 */
export function segmentSpeedRange(segments: readonly RouteSegment[]): [number, number] | null {
  return percentileRange(segments.map((segment) => segment.relativeSpeed));
}

/** A segment's colour: high on the ramp is fast, neutral when no attempt timed it. */
export function segmentColor(
  tokens: ColorTokens,
  segment: RouteSegment,
  range: [number, number] | null,
): string {
  if (segment.relativeSpeed === null || range === null) return tokens.inkMuted;
  return routeColor(tokens, normalize(segment.relativeSpeed, range));
}

interface SegmentLayerOptions {
  segments: readonly RouteSegment[];
  tokens: ColorTokens;
  theme: Theme;
}

/** The route drawn segment by segment; null for a route with no computed segments. */
export function makeSegmentLayer({
  segments,
  tokens,
  theme,
}: SegmentLayerOptions): PathLayer<RouteSegment> | null {
  if (segments.length === 0) return null;
  const range = segmentSpeedRange(segments);

  return new PathLayer<RouteSegment>({
    id: SEGMENT_LAYER_ID,
    data: segments,
    getPath: (segment) => segment.path,
    getColor: (segment) => hexToRgba(segmentColor(tokens, segment, range)),
    getWidth: SEGMENT_WIDTH_PX,
    widthUnits: "pixels",
    capRounded: true,
    jointRounded: true,
    pickable: true,
    updateTriggers: { getColor: theme },
  });
}

/**
 * The whole route as one faint line under the segments. A segment covers a stretch of
 * the route, but the stored polyline is 100 points however long the route is, so on a
 * long route some stretches hold fewer than two of them and cannot be drawn. Without
 * this the route would appear to have holes in it rather than stretches with no profile.
 */
export function makeRouteOutlineLayer(route: Route, tokens: ColorTokens): PathLayer<Route> {
  return new PathLayer<Route>({
    id: OUTLINE_LAYER_ID,
    data: [route],
    getPath: (item) => item.path,
    getColor: hexToRgba(tokens.inkMuted, OUTLINE_ALPHA),
    getWidth: OUTLINE_WIDTH_PX,
    widthUnits: "pixels",
    capRounded: true,
    jointRounded: true,
    pickable: false,
  });
}

/** The segment behind a deck.gl pick, or null for anything else on the map. */
export function pickedSegment(info: PickingInfo): RouteSegment | null {
  if (info.layer?.id !== SEGMENT_LAYER_ID) return null;
  const picked: unknown = info.object;
  return isSegment(picked) ? picked : null;
}

function isSegment(value: unknown): value is RouteSegment {
  return (
    typeof value === "object" &&
    value !== null &&
    "index" in value &&
    typeof value.index === "number" &&
    "relativeSpeed" in value
  );
}
