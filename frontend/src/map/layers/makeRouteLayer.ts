// The single-activity route and its hover cursor as deck.gl layers. The data builders
// are exported on their own so they can be tested without deck.gl.
import type { PickingInfo } from "@deck.gl/core";
import { PathLayer, ScatterplotLayer } from "@deck.gl/layers";
import { bbox } from "@turf/turf";
import type { Position } from "geojson";
import type { Activity, ActivityTrack } from "@/api/adapters";
import { hexToRgba, routeColor, normalize, percentileRange, type Rgba } from "@/design/scales";
import type { ColorTokens, Theme } from "@/design/tokens";
import { metrics, type MetricKey } from "@/lib/metrics";
import type { MapBounds } from "@/map/types";
import type { HoverPoint } from "@/store/ui";

export const ROUTE_LAYER_ID = "activity-route";
export const CURSOR_LAYER_ID = "activity-cursor";

const ROUTE_WIDTH_PX = 4;
const CURSOR_RADIUS_PX = 6;
const CURSOR_STROKE_PX = 2;

type LonLat = [number, number];

/** One piece of the route, from coordinate k to k+1, coloured by the sample it ends at. */
export interface RouteSegment {
  path: [LonLat, LonLat];
  color: Rgba;
  /** Stream index of the sample the colour comes from (coordinate k+1). */
  streamIndex: number;
}

export interface CursorDot {
  position: LonLat;
}

// ---------------------------------------------------------------- data

/**
 * The value range the route colours span: percentiles of the metric over the samples
 * that are on the track, so samples without a fix do not stretch the scale.
 */
export function trackMetricRange(
  track: ActivityTrack,
  values: readonly (number | null)[],
): [number, number] | null {
  const onTrack = track.sampleIndex.map((streamIndex) => values[streamIndex] ?? null);
  return percentileRange(onTrack);
}

/** The route range for an activity and metric, shared by the route and its legend. */
export function activityMetricRange(
  activity: Activity,
  colorBy: MetricKey,
): [number, number] | null {
  if (!activity.track) return null;
  return trackMetricRange(activity.track, metrics[colorBy].scaleValues(activity.streams));
}

export function routeSegments(
  track: ActivityTrack,
  values: readonly (number | null)[],
  tokens: ColorTokens,
): RouteSegment[] {
  const range = trackMetricRange(track, values);
  const coordinates = track.line.coordinates;
  const segments: RouteSegment[] = [];

  for (let k = 0; k < coordinates.length - 1; k++) {
    const from = toLonLat(coordinates[k]);
    const to = toLonLat(coordinates[k + 1]);
    const streamIndex = track.sampleIndex[k + 1];
    if (from === null || to === null || streamIndex === undefined) continue;
    // The line across a recording gap was never travelled.
    if (track.gapBefore?.[k + 1]) continue;

    const value = values[streamIndex] ?? null;
    segments.push({
      path: [from, to],
      color: hexToRgba(segmentColor(tokens, value, range)),
      streamIndex,
    });
  }
  return segments;
}

function segmentColor(
  tokens: ColorTokens,
  value: number | null,
  range: [number, number] | null,
): string {
  if (value === null || range === null) return tokens.inkMuted;
  return routeColor(tokens, normalize(value, range));
}

function toLonLat(position: Position | undefined): LonLat | null {
  if (position === undefined) return null;
  const [lon, lat] = position;
  if (lon === undefined || lat === undefined) return null;
  return [lon, lat];
}

/**
 * Where the cursor goes for a stream index: that sample's coordinate, or, when it has
 * no fix, the coordinate of the nearest sample that has one (the earlier on a tie).
 */
export function cursorPosition(track: ActivityTrack, streamIndex: number): LonLat | null {
  const k = nearestCoordinateIndex(track.sampleIndex, streamIndex);
  if (k === null) return null;
  return toLonLat(track.line.coordinates[k]);
}

/** Binary search over the ascending `sampleIndex` for the entry closest to `streamIndex`. */
export function nearestCoordinateIndex(
  sampleIndex: readonly number[],
  streamIndex: number,
): number | null {
  if (sampleIndex.length === 0) return null;

  // Find the first entry >= streamIndex.
  let lo = 0;
  let hi = sampleIndex.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const value = sampleIndex[mid] ?? Infinity;
    if (value < streamIndex) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }

  const after = lo;
  const before = lo - 1;
  if (after >= sampleIndex.length) return before;
  if (before < 0) return after;

  const distanceAfter = (sampleIndex[after] ?? Infinity) - streamIndex;
  const distanceBefore = streamIndex - (sampleIndex[before] ?? -Infinity);
  return distanceBefore <= distanceAfter ? before : after;
}

export function routeBounds(track: ActivityTrack): MapBounds {
  const [minLon, minLat, maxLon, maxLat] = bbox(track.line);
  return [
    [minLon, minLat],
    [maxLon, maxLat],
  ];
}

/** The stream index behind a deck.gl pick on the route, or null for anything else. */
export function pickedStreamIndex(info: PickingInfo): number | null {
  if (info.layer?.id !== ROUTE_LAYER_ID) return null;
  const picked: unknown = info.object;
  return isRouteSegment(picked) ? picked.streamIndex : null;
}

function isRouteSegment(value: unknown): value is RouteSegment {
  return (
    typeof value === "object" &&
    value !== null &&
    "streamIndex" in value &&
    typeof value.streamIndex === "number"
  );
}

// ---------------------------------------------------------------- layers

interface RouteLayerOptions {
  activity: Activity;
  colorBy: MetricKey;
  tokens: ColorTokens;
  theme: Theme;
}

/** The track as per-segment coloured paths; null for an activity without GPS. */
export function makeRouteLayer({
  activity,
  colorBy,
  tokens,
  theme,
}: RouteLayerOptions): PathLayer<RouteSegment> | null {
  if (!activity.track) return null;
  const values = metrics[colorBy].scaleValues(activity.streams);

  return new PathLayer<RouteSegment>({
    id: ROUTE_LAYER_ID,
    data: routeSegments(activity.track, values, tokens),
    getPath: (segment) => segment.path,
    getColor: (segment) => segment.color,
    getWidth: ROUTE_WIDTH_PX,
    widthUnits: "pixels",
    capRounded: true,
    jointRounded: true,
    pickable: true,
    updateTriggers: { getColor: [colorBy, theme] },
  });
}

interface CursorLayerOptions {
  activity: Activity;
  hover: HoverPoint | null;
  tokens: ColorTokens;
}

export function cursorDots(activity: Activity, hover: HoverPoint | null): CursorDot[] {
  if (hover === null || hover.activityId !== activity.summary.id || !activity.track) return [];
  const position = cursorPosition(activity.track, hover.index);
  return position === null ? [] : [{ position }];
}

/** A dot at the hovered sample; null when nothing on this activity is hovered. */
export function makeCursorLayer({
  activity,
  hover,
  tokens,
}: CursorLayerOptions): ScatterplotLayer<CursorDot> | null {
  return cursorLayer(cursorDots(activity, hover), tokens);
}

/**
 * The dot during a replay: at a position of its own choosing, not a stream sample.
 * The replay's position falls between samples; snapped to one, the dot would step
 * while the trail's head glides on ahead of it.
 */
export function makeReplayCursorLayer(
  position: [number, number] | null,
  tokens: ColorTokens,
): ScatterplotLayer<CursorDot> | null {
  return cursorLayer(position === null ? [] : [{ position }], tokens);
}

function cursorLayer(data: CursorDot[], tokens: ColorTokens): ScatterplotLayer<CursorDot> | null {
  if (data.length === 0) return null;

  return new ScatterplotLayer<CursorDot>({
    id: CURSOR_LAYER_ID,
    data,
    getPosition: (dot) => dot.position,
    getRadius: CURSOR_RADIUS_PX,
    radiusUnits: "pixels",
    getFillColor: hexToRgba(tokens.cursor),
    stroked: true,
    getLineColor: hexToRgba(tokens.surface),
    getLineWidth: CURSOR_STROKE_PX,
    lineWidthUnits: "pixels",
    pickable: false,
  });
}
