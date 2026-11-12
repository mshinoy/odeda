// The fixed colour scales every map and chart shares. Pure functions over tokens, so
// the same value gets the same colour on a route, a chart line and a legend.
import type { ColorTokens } from "@/design/tokens";
import type { ActivityKind } from "@/lib/activityKind";

/** [r, g, b, a] 0-255, the colour format deck.gl layers take. */
export type Rgba = [number, number, number, number];

export function kindColor(tokens: ColorTokens, kind: ActivityKind): string {
  return tokens.kind[kind];
}

/** Zones are numbered 1-5; anything outside clamps to the nearest zone. */
export function hrZoneColor(tokens: ColorTokens, zone: number): string {
  const index = Math.min(Math.max(Math.round(zone), 1), 5) - 1;
  return tokens.hrZones[index] ?? tokens.inkMuted;
}

/**
 * The value range a metric scale spans: the 5th to 95th percentile, so one GPS spike
 * or a stop at a traffic light does not wash out the rest of the route.
 */
export function percentileRange(values: readonly (number | null)[]): [number, number] | null {
  const finite = values
    .filter((v): v is number => v !== null && Number.isFinite(v))
    .sort((a, b) => a - b);
  if (finite.length === 0) return null;

  const at = (p: number) => finite[Math.round(p * (finite.length - 1))] ?? 0;
  const lo = at(0.05);
  const hi = at(0.95);
  return hi > lo ? [lo, hi] : [lo, lo + 1];
}

/** Where `value` sits in `range`, clamped to 0..1. */
export function normalize(value: number, [lo, hi]: [number, number]): number {
  return Math.min(Math.max((value - lo) / (hi - lo), 0), 1);
}

/** The metric ramp step for t in 0..1 (0 = low, 1 = high). Stepped, not interpolated. */
export function metricColor(tokens: ColorTokens, t: number): string {
  const ramp = tokens.metricRamp;
  const index = Math.min(Math.floor(t * ramp.length), ramp.length - 1);
  return ramp[Math.max(index, 0)] ?? tokens.inkMuted;
}

/** The route colour for t in 0..1 (0 = low, 1 = high), stepped like `metricColor`. */
export function routeColor(tokens: ColorTokens, t: number): string {
  const ramp = tokens.routeRamp;
  const index = Math.min(Math.floor(t * ramp.length), ramp.length - 1);
  return ramp[Math.max(index, 0)] ?? tokens.inkMuted;
}

/** "#rrggbb" to deck.gl's [r, g, b, a]. */
export function hexToRgba(hex: string, alpha = 255): Rgba {
  const value = Number.parseInt(hex.replace("#", ""), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255, alpha];
}
