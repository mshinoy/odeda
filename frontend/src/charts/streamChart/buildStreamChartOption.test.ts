import { describe, expect, it } from "vitest";
import type { ActivityStreams } from "@/api/adapters";
import type { ChartOption } from "@/charts/echarts";
import {
  buildStreamChartOption,
  formatTooltipLine,
  formatYTick,
  streamLineColor,
  streamYScale,
} from "@/charts/streamChart/buildStreamChartOption";
import { streamXAxis } from "@/charts/streamChart/streamXAxis";
import { colorTokens, type ColorTokens } from "@/design/tokens";
import type { ActivityKind } from "@/lib/activityKind";
import { metrics } from "@/lib/metrics";

// Sentinel strings instead of real colours, so a match proves the colour came from here.
const tokens: ColorTokens = {
  ...colorTokens.light,
  surface: "token-surface",
  ink: "token-ink",
  inkMuted: "token-ink-muted",
  border: "token-border",
  gridline: "token-gridline",
  cursor: "token-cursor",
  kind: { ...colorTokens.light.kind, run: "token-kind-run", ride: "token-kind-ride" },
  hrZones: ["token-z1", "token-z2", "token-z3", "token-z4", "token-z5"],
  metricRamp: ["r0", "r1", "r2", "r3", "r4", "r5", "r6"],
};

/** `n` samples 10 s apart at 3 m/s (5:33 /km), HR 140-149, a gentle climb. */
function makeStreams(n: number, overrides: Partial<ActivityStreams> = {}): ActivityStreams {
  const indices = Array.from({ length: n }, (_, i) => i);
  return {
    length: n,
    elapsedS: indices.map((i) => i * 10),
    distanceM: indices.map((i) => i * 30),
    hr: indices.map((i) => 140 + (i % 10)),
    speedMps: indices.map(() => 3),
    smoothSpeedMps: indices.map(() => 3),
    paceSPerKm: indices.map(() => 1000 / 3),
    cadenceSpm: indices.map(() => null),
    altitudeM: indices.map((i) => 100 + i),
    gradientPct: indices.map(() => null),
    lat: indices.map(() => null),
    lon: indices.map(() => null),
    ...overrides,
  };
}

// ---------------------------------------------------------------- narrowing helpers

function single<T>(value: T | T[] | undefined): T {
  if (value === undefined || Array.isArray(value)) throw new Error("expected exactly one");
  return value;
}

function yAxisOf(option: ChartOption) {
  const axis = single(option.yAxis);
  if (axis.type !== "value") throw new Error("expected a value axis");
  return axis;
}

function xAxisOf(option: ChartOption) {
  return single(option.xAxis);
}

function lineSeriesOf(option: ChartOption) {
  const list = Array.isArray(option.series) ? option.series : [option.series];
  const [series] = list;
  if (list.length !== 1 || series?.type !== "line") throw new Error("expected one line series");
  return series;
}

function pointsOf(option: ChartOption): unknown[][] {
  const data: unknown = lineSeriesOf(option).data;
  if (!Array.isArray(data)) throw new Error("expected data");
  return data.map((point: unknown) => {
    if (!Array.isArray(point)) throw new Error("expected [x, y]");
    return point;
  });
}

function build(streams: ActivityStreams, key: keyof typeof metrics, kind: ActivityKind = "run") {
  return buildStreamChartOption({ streams, metric: metrics[key], kind, tokens });
}

// ---------------------------------------------------------------- the option

describe("buildStreamChartOption", () => {
  it("inverts the y-axis for pace only", () => {
    const streams = makeStreams(50);
    expect(yAxisOf(build(streams, "pace")).inverse).toBe(true);
    expect(yAxisOf(build(streams, "hr")).inverse).toBe(false);
    expect(yAxisOf(build(streams, "elevation")).inverse).toBe(false);
    // A ride plots km/h, where bigger is faster, so it is not inverted.
    expect(yAxisOf(build(streams, "pace", "ride")).inverse).toBe(false);
  });

  it("plots x in km when the activity has distance", () => {
    const option = build(makeStreams(101), "hr");
    const points = pointsOf(option);
    expect(points[0]?.[0]).toBe(0);
    expect(points[100]?.[0]).toBeCloseTo(3);
    expect(xAxisOf(option).max).toBeCloseTo(3);
  });

  it("plots x in elapsed minutes without distance", () => {
    const n = 61;
    const streams = makeStreams(n, { distanceM: Array.from({ length: n }, () => null) });
    const option = build(streams, "hr");
    const points = pointsOf(option);
    expect(streamXAxis(streams).unit).toBe("min");
    expect(points[60]?.[0]).toBe(10);
    expect(xAxisOf(option).max).toBe(10);
  });

  it("takes every colour from the passed tokens", () => {
    const streams = makeStreams(50);
    const pace = build(streams, "pace");
    const hr = build(streams, "hr");

    expect(lineSeriesOf(pace).lineStyle?.color).toBe("token-kind-run");
    expect(lineSeriesOf(hr).lineStyle?.color).toBe("token-z4");
    expect(yAxisOf(pace).splitLine?.lineStyle?.color).toBe("token-gridline");
    expect(yAxisOf(pace).axisLabel?.color).toBe("token-ink-muted");
    expect(xAxisOf(pace).axisLabel?.color).toBe("token-ink-muted");

    const tooltip = single(pace.tooltip);
    expect(tooltip.axisPointer?.lineStyle?.color).toBe("token-cursor");
    expect(tooltip.axisPointer?.lineStyle?.width).toBe(1);
    expect(tooltip.backgroundColor).toBe("token-surface");
  });

  it("keeps null samples as gaps", () => {
    const hr = makeStreams(20).hr.map((bpm, i) => (i >= 5 && i < 8 ? null : bpm));
    const option = build(makeStreams(20, { hr }), "hr");
    const points = pointsOf(option);

    expect(points).toHaveLength(20);
    expect(points[6]?.[1]).toBeNull();
    expect(points[4]?.[1]).toBe(144);
    expect(lineSeriesOf(option).connectNulls).toBe(false);
  });

  it("has exactly one y-axis and no legend", () => {
    const option = build(makeStreams(50), "pace");
    expect(Array.isArray(option.yAxis)).toBe(false);
    expect(option.yAxis).toBeDefined();
    expect(option).not.toHaveProperty("legend");
  });

  it("fills the area under elevation only", () => {
    const streams = makeStreams(50);
    expect(lineSeriesOf(build(streams, "elevation")).areaStyle).toBeDefined();
    expect(lineSeriesOf(build(streams, "hr")).areaStyle).toBeUndefined();
    expect(lineSeriesOf(build(streams, "pace")).areaStyle).toBeUndefined();
  });

  it("draws large streams cheaply and without animation", () => {
    const option = build(makeStreams(5000), "hr");
    const series = lineSeriesOf(option);
    expect(option.animation).toBe(false);
    expect(series.sampling).toBe("lttb");
    expect(series.showSymbol).toBe(false);
  });

  it("hides x labels when asked, for charts stacked above the last one", () => {
    const option = buildStreamChartOption({
      streams: makeStreams(50),
      metric: metrics.hr,
      kind: "run",
      tokens,
      showXAxisLabels: false,
    });
    expect(xAxisOf(option).axisLabel?.show).toBe(false);
  });
});

describe("the pace axis", () => {
  /** Calls the option's y tick formatter the way ECharts does. */
  function yTickLabel(option: ChartOption, value: number): string {
    const formatter = yAxisOf(option).axisLabel?.formatter;
    if (typeof formatter !== "function") throw new Error("expected a formatter");
    return formatter(value, 0, null);
  }

  it("says /km once, on the top tick only", () => {
    const option = build(makeStreams(50), "pace");
    const axis = yAxisOf(option);
    const top = axis.min;
    const bottom = axis.max;
    const step = axis.interval;
    if (typeof top !== "number" || typeof bottom !== "number" || typeof step !== "number") {
      throw new Error("expected a fixed scale");
    }
    // Inverted: the smallest s/km (fastest) is drawn at the top.
    expect(yTickLabel(option, top)).toMatch(/^\d+:\d\d \/km$/);
    expect(yTickLabel(option, top + step)).toMatch(/^\d+:\d\d$/);
    expect(yTickLabel(option, bottom)).toMatch(/^\d+:\d\d$/);
  });

  it("keeps the unit on every tick for other metrics", () => {
    expect(formatYTick(metrics.hr, 150, "run", false)).toBe("150 bpm");
    expect(formatYTick(metrics.pace, 300, "run", false)).toBe("5:00");
    expect(formatYTick(metrics.pace, 300, "run", true)).toBe("5:00 /km");
  });

  it("plots a ride in km/h, faster at the top, with the unit said once", () => {
    // 5 m/s is 18 km/h. Before T18 this axis read "–, 5:00, 10:00" in s/km while the
    // activity's header, splits and legend all said km/h.
    const n = 50;
    const streams = makeStreams(n, {
      smoothSpeedMps: Array.from({ length: n }, (_, i) => 5 + (i % 4)),
    });
    const option = build(streams, "pace", "ride");
    const axis = yAxisOf(option);
    expect(axis.inverse).toBe(false);
    expect(pointsOf(option)[0]?.[1]).toBeCloseTo(18);
    const top = axis.max;
    const step = axis.interval;
    if (typeof top !== "number" || typeof step !== "number") {
      throw new Error("expected a fixed scale");
    }
    expect(yTickLabel(option, top)).toMatch(/^[\d.]+ km\/h$/);
    expect(yTickLabel(option, top - step)).toMatch(/^[\d.]+$/);
  });

  it("plots a swim per 100 m, faster at the top", () => {
    const n = 50;
    const streams = makeStreams(n, {
      smoothSpeedMps: Array.from({ length: n }, () => 1),
    });
    const option = build(streams, "pace", "swim");
    expect(yAxisOf(option).inverse).toBe(true);
    // 1 m/s is 100 s per 100 m.
    expect(pointsOf(option)[0]?.[1]).toBeCloseTo(100);
    expect(formatYTick(metrics.pace, 100, "swim", true)).toBe("1:40 /100m");
    expect(formatYTick(metrics.pace, 100, "swim", false)).toBe("1:40");
  });

  it("puts the tooltip in the same unit as the axis", () => {
    const km = streamXAxis(makeStreams(200));
    expect(formatTooltipLine(metrics.pace, "ride", km, 3.4, 18)).toBe("18.0 km/h · 3.4 km");
    expect(formatTooltipLine(metrics.pace, "swim", km, 3.4, 100)).toBe("1:40 /100m · 3.4 km");
    expect(formatTooltipLine(metrics.pace, "run", km, 3.4, 312)).toBe("5:12 /km · 3.4 km");
  });

  it("gives a steady ride a sensible height rather than a 30 km/h one", () => {
    // The old floor was 30, which is right for s/km and absurd for km/h.
    const scale = streamYScale(metrics.pace, [18, 18.4, 19], "ride");
    expect((scale?.max ?? 0) - (scale?.min ?? 0)).toBeLessThan(10);
    expect((scale?.max ?? 0) - (scale?.min ?? 0)).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------- the parts

describe("streamYScale", () => {
  it("scales to the data rather than from zero, on round values", () => {
    const scale = streamYScale(metrics.hr, [142, 150, 171], "run");
    if (scale === null) throw new Error("expected a scale");
    expect(scale.min).toBeGreaterThan(0);
    expect(scale.min).toBeLessThan(142);
    expect(scale.max).toBeGreaterThan(171);
    expect(scale.min % scale.step).toBe(0);
    expect(scale.max % scale.step).toBe(0);
  });

  it("ignores a stop's pace spike", () => {
    const pace = [...Array.from({ length: 200 }, (_, i) => 300 + (i % 20)), 1500];
    const scale = streamYScale(metrics.pace, pace, "run");
    expect(scale?.max).toBeLessThan(400);
  });

  it("gives a flat course a minimum height", () => {
    const scale = streamYScale(metrics.elevation, [100, 101, 100], "run");
    expect((scale?.max ?? 0) - (scale?.min ?? 0)).toBeGreaterThanOrEqual(10);
  });

  it("is null without values", () => {
    expect(streamYScale(metrics.hr, [null, null], "run")).toBeNull();
  });
});

describe("formatTooltipLine", () => {
  const km = streamXAxis(makeStreams(200));

  it("reads value, then position", () => {
    expect(formatTooltipLine(metrics.pace, "run", km, 3.4, 312)).toBe("5:12 /km · 3.4 km");
    expect(formatTooltipLine(metrics.hr, "run", km, 0.5, 151)).toBe("151 bpm · 500 m");
  });

  it("shows elapsed time without distance", () => {
    const n = 10;
    const minutes = streamXAxis(
      makeStreams(n, { distanceM: Array.from({ length: n }, () => null) }),
    );
    expect(formatTooltipLine(metrics.elevation, "run", minutes, 12.5, 88)).toBe("88 m · 12:30");
  });

  it("marks a missing value", () => {
    expect(formatTooltipLine(metrics.hr, "run", km, 1, null)).toBe("– · 1.0 km");
  });
});

describe("streamLineColor", () => {
  it("uses the kind colour for pace and elevation, HR zone 4 for HR", () => {
    expect(streamLineColor("pace", "ride", tokens)).toBe("token-kind-ride");
    expect(streamLineColor("elevation", "run", tokens)).toBe("token-kind-run");
    expect(streamLineColor("hr", "ride", tokens)).toBe("token-z4");
  });
});

describe("streamXAxis", () => {
  it("carries the last distance over missing samples", () => {
    const axis = streamXAxis(makeStreams(4, { distanceM: [null, 1000, null, 2500] }));
    expect(axis.values).toEqual([0, 1, 1, 2.5]);
    expect(axis.max).toBe(2.5);
  });

  it("formats ticks through format.ts", () => {
    const axis = streamXAxis(makeStreams(200));
    expect(axis.format(2)).toBe("2.0 km");
  });
});
