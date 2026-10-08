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

/**
 * The size of the squares activity is weighed in: about 55 km, so a city and its
 * suburbs fall in one or two, and another country in another.
 */
const FOCUS_SQUARE_DEG = 0.5;

/**
 * Where most of the activity is: the busiest ~55 km square by GPS points and the squares
 * round it, rather than every point ever recorded. A run abroad otherwise opens the map
 * on half a continent with home a dot in it. A filter to one trip makes that trip the
 * busiest square, so it opens there instead. Null when there are no cells.
 */
export function heatmapFocusBounds(cells: readonly HeatmapCell[]): MapBounds | null {
  if (cells.length === 0) return null;

  const square = (cell: HeatmapCell) =>
    [Math.floor(cell.lon / FOCUS_SQUARE_DEG), Math.floor(cell.lat / FOCUS_SQUARE_DEG)] as const;
  const weight = new Map<string, number>();
  for (const cell of cells) {
    const key = square(cell).join(",");
    weight.set(key, (weight.get(key) ?? 0) + cell.count);
  }
  let busiest = "";
  let most = -1;
  for (const [key, count] of weight) {
    if (count > most) {
      busiest = key;
      most = count;
    }
  }
  const [bx = 0, by = 0] = busiest.split(",").map(Number);
  const nearby = cells.filter((cell) => {
    const [x, y] = square(cell);
    return Math.abs(x - bx) <= 1 && Math.abs(y - by) <= 1;
  });
  return heatmapBounds(nearby);
}
