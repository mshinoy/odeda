import { HeatmapLayer } from "@deck.gl/aggregation-layers";
import { describe, expect, it } from "vitest";
import type { Heatmap, HeatmapCell } from "@/api/adapters";
import { hexToRgba } from "@/design/scales";
import { colorTokens } from "@/design/tokens";
import {
  cellWeight,
  HEATMAP_LAYER_ID,
  heatmapBounds,
  heatmapColorRange,
  makeHeatmapLayer,
} from "@/map/layers/makeHeatmapLayer";

const light = colorTokens.light;

const cells: HeatmapCell[] = [
  { lon: 51.5, lat: 25.3, count: 400 },
  { lon: 51.4, lat: 25.2, count: 10 },
  { lon: 51.6, lat: 25.1, count: 1 },
];

function heatmap(overrides: Partial<Heatmap> = {}): Heatmap {
  return { precision: 4, maxCount: 400, cells, ...overrides };
}

describe("cellWeight", () => {
  it("compresses the count so a rare cell is still visible against a daily one", () => {
    // log1p: 400 visits weigh ~6, one visit ~0.69 — a 9x range, not 400x.
    expect(cellWeight({ lon: 0, lat: 0, count: 400 })).toBeCloseTo(5.994, 4);
    expect(cellWeight({ lon: 0, lat: 0, count: 1 })).toBeCloseTo(0.6931, 4);
  });

  it("gives an empty cell no weight", () => {
    expect(cellWeight({ lon: 0, lat: 0, count: 0 })).toBe(0);
  });
});

describe("heatmapColorRange", () => {
  it("is the metric ramp, low to high", () => {
    expect(heatmapColorRange(light)).toEqual(light.metricRamp.map((c) => hexToRgba(c)));
  });

  it("follows the theme", () => {
    expect(heatmapColorRange(colorTokens.dark)).not.toEqual(heatmapColorRange(light));
  });
});

describe("heatmapBounds", () => {
  it("is the box the cells fill, lon before lat", () => {
    expect(heatmapBounds(cells)).toEqual([
      [51.4, 25.1],
      [51.6, 25.3],
    ]);
  });

  it("is null without cells, so the caller can show an empty state instead", () => {
    expect(heatmapBounds([])).toBeNull();
  });

  it("survives a single cell", () => {
    expect(heatmapBounds([{ lon: 51.5, lat: 25.3, count: 2 }])).toEqual([
      [51.5, 25.3],
      [51.5, 25.3],
    ]);
  });
});

describe("makeHeatmapLayer", () => {
  it("builds a HeatmapLayer over the cells", () => {
    const layer = makeHeatmapLayer({ heatmap: heatmap(), tokens: light, theme: "light" });
    expect(layer).toBeInstanceOf(HeatmapLayer);
    expect(layer?.id).toBe(HEATMAP_LAYER_ID);
    expect(layer?.props.data).toBe(cells);
  });

  it("positions a cell lon-first and weighs it by log1p", () => {
    const layer = makeHeatmapLayer({ heatmap: heatmap(), tokens: light, theme: "light" });
    const cell = cells[0];
    if (layer === null || cell === undefined) throw new Error("expected a layer over cells");
    expect(layer.props.getPosition(cell, positionContext())).toEqual([51.5, 25.3]);
    expect(layer.props.getWeight).toBe(cellWeight);
    expect(layer.props.colorRange).toEqual(heatmapColorRange(light));
  });

  it("is null when the filters left nothing to draw", () => {
    const empty = heatmap({ cells: [], maxCount: 0 });
    expect(makeHeatmapLayer({ heatmap: empty, tokens: light, theme: "light" })).toBeNull();
  });
});

/** deck.gl passes an accessor context alongside the object; ours ignores it. */
function positionContext() {
  return { index: 0, data: cells, target: [] };
}
