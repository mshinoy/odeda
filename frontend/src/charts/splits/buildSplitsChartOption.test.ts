import { describe, expect, it } from "vitest";
import type { Split } from "@/api/adapters";
import type { ChartOption } from "@/charts/echarts";
import {
  buildSplitsChartOption,
  splitMeasure,
  splitScale,
  splitTooltip,
} from "@/charts/splits/buildSplitsChartOption";
import { colorTokens, type ColorTokens } from "@/design/tokens";

const tokens: ColorTokens = {
  ...colorTokens.light,
  gridline: "token-gridline",
  inkMuted: "token-ink-muted",
  kind: { ...colorTokens.light.kind, run: "token-kind-run", ride: "token-kind-ride" },
};

// 5:00, 5:30 and 4:50 per km.
const runSplits: Split[] = [
  { km: 1, seconds: 300, avgHr: 140 },
  { km: 2, seconds: 330, avgHr: 146.4 },
  { km: 3, seconds: 290, avgHr: null },
];

function single<T>(value: T | T[] | undefined): T {
  if (value === undefined || Array.isArray(value)) throw new Error("expected exactly one");
  return value;
}

function barSeriesOf(option: ChartOption) {
  const list = Array.isArray(option.series) ? option.series : [option.series];
  const [series] = list;
  if (list.length !== 1 || series?.type !== "bar") throw new Error("expected one bar series");
  return series;
}

function heightsOf(option: ChartOption): number[] {
  const data: unknown = barSeriesOf(option).data;
  if (!Array.isArray(data)) throw new Error("expected data");
  return data.map((value: unknown) => {
    if (typeof value !== "number") throw new Error("expected a number");
    return value;
  });
}

/** The y-axis, which is always a value axis here. */
function yAxisOf(option: ChartOption) {
  const axis = single(option.yAxis);
  if (axis.type !== "value") throw new Error("expected a value axis");
  return axis;
}

function yTickLabel(option: ChartOption, value: number): string {
  const formatter = yAxisOf(option).axisLabel?.formatter;
  if (typeof formatter !== "function") throw new Error("expected a formatter");
  return formatter(value, 0, null);
}

describe("buildSplitsChartOption", () => {
  const option = buildSplitsChartOption({ splits: runSplits, kind: "run", tokens });

  it("draws one bar per km, faster splits taller", () => {
    const [km1, km2, km3] = heightsOf(option);
    expect(heightsOf(option)).toHaveLength(3);
    if (km1 === undefined || km2 === undefined || km3 === undefined) throw new Error("bars");
    expect(km3).toBeGreaterThan(km1);
    expect(km1).toBeGreaterThan(km2);
    expect(km2).toBeGreaterThan(0);
  });

  it("labels the km under each bar", () => {
    expect(single(option.xAxis)).toMatchObject({ type: "category", data: ["1", "2", "3"] });
  });

  it("reads the y-axis as pace, with /km on the top tick only", () => {
    const axis = yAxisOf(option);
    const max = axis.max;
    const step = axis.interval;
    if (typeof max !== "number" || typeof step !== "number") throw new Error("fixed scale");
    // 290-330 s padded by 15% of 40 s → 284-336 s; 52 s over 3 intervals → 20 s steps;
    // snapped outwards → 280-340 s: 4:40 at the top, 5:40 at the bottom.
    expect(step).toBe(20);
    expect(yTickLabel(option, max)).toBe("4:40 /km");
    expect(yTickLabel(option, 0)).toBe("5:40");
    expect(yTickLabel(option, step)).toBe("5:20");
  });

  it("takes its colours from the tokens, in the kind's colour", () => {
    expect(barSeriesOf(option).color).toBe("token-kind-run");
    expect(single(option.yAxis).splitLine?.lineStyle).toMatchObject({ color: "token-gridline" });
    expect(single(option.xAxis).axisLabel?.color).toBe("token-ink-muted");
    expect(option).not.toHaveProperty("legend");
  });

  it("reads a ride in km/h, faster still taller", () => {
    // 2:00, 1:48 and 2:24 per km: 30, 33.3 and 25 km/h.
    const ride: Split[] = [
      { km: 1, seconds: 120, avgHr: 120 },
      { km: 2, seconds: 108, avgHr: 125 },
      { km: 3, seconds: 144, avgHr: 118 },
    ];
    const rideOption = buildSplitsChartOption({ splits: ride, kind: "ride", tokens });
    const [km1, km2, km3] = heightsOf(rideOption);
    if (km1 === undefined || km2 === undefined || km3 === undefined) throw new Error("bars");
    expect(km2).toBeGreaterThan(km1);
    expect(km1).toBeGreaterThan(km3);
    expect(barSeriesOf(rideOption).color).toBe("token-kind-ride");

    const max = single(rideOption.yAxis).max;
    if (typeof max !== "number") throw new Error("fixed scale");
    expect(yTickLabel(rideOption, max)).toMatch(/^\d+ km\/h$/);
    expect(yTickLabel(rideOption, 0)).toMatch(/^\d+$/);
  });
});

describe("splitScale", () => {
  it("maps heights back to the unit's value", () => {
    const scale = splitScale(splitMeasure("run"), runSplits);
    if (scale === null) throw new Error("expected a scale");
    // The bottom of the axis is the slow end, 5:40 /km (see above); km 1 at 5:00 is 40 s faster.
    expect(scale.labelAt(0)).toBe(340);
    expect(scale.heights[0]).toBe(40);
    expect(scale.labelAt(scale.heights[0] ?? 0)).toBe(300);
  });

  it("is null without splits", () => {
    expect(splitScale(splitMeasure("run"), [])).toBeNull();
  });
});

describe("splitMeasure", () => {
  it("uses pace on foot, /100m in water and km/h otherwise", () => {
    expect(splitMeasure("run").tickWithUnit(300)).toBe("5:00 /km");
    expect(splitMeasure("walk").tickWithUnit(600)).toBe("10:00 /km");
    expect(splitMeasure("swim").tickWithUnit(110)).toBe("1:50 /100m");
    expect(splitMeasure("ride").tickWithUnit(30)).toBe("30 km/h");
    expect(splitMeasure("ride").value({ km: 1, seconds: 120, avgHr: null })).toBe(30);
  });
});

describe("splitTooltip", () => {
  it("reads km, pace, then HR", () => {
    expect(splitTooltip({ km: 2, seconds: 330, avgHr: 146.4 }, "run")).toBe(
      "Km 2 · 5:30 /km · 146 bpm",
    );
  });

  it("leaves HR out when missing, and is sport-aware", () => {
    expect(splitTooltip({ km: 7, seconds: 120, avgHr: null }, "ride")).toBe("Km 7 · 30.0 km/h");
  });
});
