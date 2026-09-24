import { describe, expect, it } from "vitest";
import type { HrZoneTime } from "@/api/adapters";
import type { ChartOption } from "@/charts/echarts";
import {
  buildHrZonesOption,
  zoneLabel,
  zoneShares,
  zoneTooltip,
} from "@/charts/hrZones/buildHrZonesOption";
import { colorTokens, type ColorTokens } from "@/design/tokens";

const tokens: ColorTokens = {
  ...colorTokens.light,
  hrZones: ["token-z1", "token-z2", "token-z3", "token-z4", "token-z5"],
};

// 25:00, 50:00 and 5:00: 31.25%, 62.5% and 6.25% of 80 minutes. Zones 4-5 empty.
const zones: HrZoneTime[] = [
  { zone: 2, seconds: 3000 },
  { zone: 1, seconds: 1500 },
  { zone: 3, seconds: 300 },
  { zone: 4, seconds: 0 },
  { zone: 5, seconds: 0 },
];

function barSeriesOf(option: ChartOption) {
  const list = Array.isArray(option.series) ? option.series : [option.series];
  return list.map((series) => {
    if (series?.type !== "bar") throw new Error("expected bar series");
    return series;
  });
}

describe("zoneShares", () => {
  it("keeps zones with time, in zone order, with their share", () => {
    expect(zoneShares(zones)).toEqual([
      { zone: 1, seconds: 1500, share: 0.3125 },
      { zone: 2, seconds: 3000, share: 0.625 },
      { zone: 3, seconds: 300, share: 0.0625 },
    ]);
  });

  it("is empty when no zone has time", () => {
    expect(zoneShares([{ zone: 1, seconds: 0 }])).toEqual([]);
    expect(zoneShares([])).toEqual([]);
  });
});

describe("zone labels", () => {
  it("shows name and time on wide segments, the name on narrow ones, nothing on slivers", () => {
    expect(zoneLabel({ zone: 2, seconds: 3000, share: 0.625 })).toBe("Z2 50:00");
    expect(zoneLabel({ zone: 3, seconds: 300, share: 0.0625 })).toBe("Z3");
    expect(zoneLabel({ zone: 5, seconds: 20, share: 0.01 })).toBe("");
  });

  it("puts time and share in the tooltip", () => {
    expect(zoneTooltip({ zone: 1, seconds: 1500, share: 0.3125 })).toBe("Z1 · 25:00 · 31%");
  });
});

describe("buildHrZonesOption", () => {
  const option = buildHrZonesOption({ zones, tokens });

  it("stacks one segment per zone with time, on one bar", () => {
    const series = barSeriesOf(option);
    expect(series).toHaveLength(3);
    expect(series.map((s) => s.stack)).toEqual(["zones", "zones", "zones"]);
    expect(series.map((s) => s.data)).toEqual([[1500], [3000], [300]]);
  });

  it("colours each segment from the HR zone tokens", () => {
    expect(barSeriesOf(option).map((s) => s.color)).toEqual(["token-z1", "token-z2", "token-z3"]);
  });

  it("spans exactly the time in zones, with no axes shown", () => {
    const xAxis = option.xAxis;
    if (xAxis === undefined || Array.isArray(xAxis)) throw new Error("expected one x-axis");
    expect(xAxis).toMatchObject({ show: false, min: 0, max: 4800 });
    expect(option).not.toHaveProperty("legend");
  });

  it("rounds only the bar's outer ends", () => {
    const radii = barSeriesOf(option).map((s) => s.itemStyle?.borderRadius);
    expect(radii[0]).toEqual([3, 0, 0, 3]);
    expect(radii[1]).toEqual([0, 0, 0, 0]);
    expect(radii[2]).toEqual([0, 3, 3, 0]);
  });
});
