import { describe, expect, it } from "vitest";
import type { HeatmapCell } from "@/api/adapters";
import { heatmapFocusBounds } from "@/map/heatmapBounds";

// Doha: most of the activity. Kerala and Saudi Arabia: a trip or two each.
const doha: HeatmapCell[] = [
  { lon: 51.44, lat: 25.26, count: 120 },
  { lon: 51.53, lat: 25.39, count: 300 },
  { lon: 51.49, lat: 25.3, count: 900 },
];
const kerala: HeatmapCell[] = [{ lon: 76.74, lat: 9.56, count: 80 }];
const saudi: HeatmapCell[] = [{ lon: 50.02, lat: 26.32, count: 40 }];

describe("heatmapFocusBounds", () => {
  it("opens on home, not on every country with a point", () => {
    expect(heatmapFocusBounds([...doha, ...kerala, ...saudi])).toEqual([
      [51.44, 25.26],
      [51.53, 25.39],
    ]);
  });

  it("opens on a trip when the filter leaves only the trip", () => {
    expect(heatmapFocusBounds(kerala)).toEqual([
      [76.74, 9.56],
      [76.74, 9.56],
    ]);
  });

  it("keeps the edge of the city that falls in the next square", () => {
    // 51.49 and 51.53 straddle the 51.5 line between two squares.
    const bounds = heatmapFocusBounds(doha);
    expect(bounds?.[1][0]).toBe(51.53);
  });

  it("weighs squares by points, not by how many cells they have", () => {
    const sparse: HeatmapCell[] = Array.from({ length: 10 }, (_, i) => ({
      lon: 76.7 + i * 0.001,
      lat: 9.56,
      count: 1,
    }));
    expect(heatmapFocusBounds([...doha, ...sparse])?.[0][0]).toBe(51.44);
  });

  it("is null without cells", () => {
    expect(heatmapFocusBounds([])).toBeNull();
  });
});
