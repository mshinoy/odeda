// The box a heatmap fills. Apart from the deck.gl layer, so the Map page can know where
// to open the map without loading deck.gl first.
import type { HeatmapCell } from "@/api/adapters";
import type { MapBounds } from "@/map/types";

/** The box the cells fill, or null when there are none. */
export function heatmapBounds(cells: readonly HeatmapCell[]): MapBounds | null {
  if (cells.length === 0) return null;

  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const cell of cells) {
    minLon = Math.min(minLon, cell.lon);
    minLat = Math.min(minLat, cell.lat);
    maxLon = Math.max(maxLon, cell.lon);
    maxLat = Math.max(maxLat, cell.lat);
  }
  return [
    [minLon, minLat],
    [maxLon, maxLat],
  ];
}
