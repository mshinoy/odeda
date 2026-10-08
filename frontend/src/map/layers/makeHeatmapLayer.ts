// The all-activities heatmap as a deck.gl layer. The weighting and the colour range are
// exported on their own so they can be tested without deck.gl; the bounds live in
// `heatmapBounds.ts`, which the page reads before deck.gl has loaded.
import { HeatmapLayer } from "@deck.gl/aggregation-layers";
import type { Heatmap, HeatmapCell } from "@/api/adapters";
import { hexToRgba, type Rgba } from "@/design/scales";
import type { ColorTokens, Theme } from "@/design/tokens";

export const HEATMAP_LAYER_ID = "activity-heatmap";

/** How far a cell spreads. Wide enough to join a street into a line, narrow enough to keep it one street. */
const RADIUS_PX = 18;
/** deck.gl drops aggregated weights below this fraction of the maximum, so one-off detours fade out. */
const THRESHOLD = 0.03;
const OPACITY = 0.75;

/**
 * A cell's weight. Counts span three orders of magnitude — the street outside the
 * door against a road crossed once — so a linear weight would leave everything but
 * the doorstep invisible. log1p compresses that into a range the ramp can show.
 */
export function cellWeight(cell: HeatmapCell): number {
  return Math.log1p(cell.count);
}

/** The metric ramp as deck.gl colours, low density to high. */
export function heatmapColorRange(tokens: ColorTokens): Rgba[] {
  return tokens.metricRamp.map((color) => hexToRgba(color));
}

interface HeatmapLayerOptions {
  heatmap: Heatmap;
  tokens: ColorTokens;
  theme: Theme;
}

/** The density layer; null when the filters left no points to draw. */
export function makeHeatmapLayer({
  heatmap,
  tokens,
  theme,
}: HeatmapLayerOptions): HeatmapLayer<HeatmapCell> | null {
  if (heatmap.cells.length === 0) return null;

  return new HeatmapLayer<HeatmapCell>({
    id: HEATMAP_LAYER_ID,
    data: heatmap.cells,
    getPosition: (cell) => [cell.lon, cell.lat],
    getWeight: cellWeight,
    colorRange: heatmapColorRange(tokens),
    radiusPixels: RADIUS_PX,
    threshold: THRESHOLD,
    opacity: OPACITY,
    pickable: false,
    updateTriggers: { colorRange: theme },
  });
}
