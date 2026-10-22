import { describe, expect, it } from "vitest";
import type { BodySeries } from "@/api/queries/useBody";
import type { DailyRow, MetricTrend, ReadinessPoint } from "@/api/queries/useHealth";
import { hoveredIndex, tooltipHtml } from "@/charts/chrome";
import {
  movement,
  summarizeBodyBattery,
  summarizeFatPct,
  summarizeMass,
  summarizeMetric,
  summarizeReadiness,
  summarizeSleep,
  summarizeWeight,
} from "@/charts/health/rangeStats";
import { windowBody, windowReadiness, windowRows, windowTrend } from "@/charts/health/windowData";
import {
  addDays,
  indicesFromWindow,
  sliceRange,
  windowFromIndices,
} from "@/charts/health/zoomWindow";
import { colorTokens } from "@/design/tokens";
import { RESTING_HR_METRIC } from "@/features/health/healthMetrics";
import { zoomKey } from "@/features/health/useChartZoom";

const tokens = colorTokens.light;
const days = ["2026-09-20", "2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24"];

describe("zoomWindow", () => {
  it("adds days across a month end", () => {
    expect(addDays("2026-09-28", 5)).toBe("2026-10-03");
  });

  it("turns a drag between two points into the days they span, whichever way it went", () => {
    expect(windowFromIndices(days, 1, 3, "day")).toEqual({ from: "2026-09-21", to: "2026-09-23" });
    expect(windowFromIndices(days, 3, 1, "day")).toEqual({ from: "2026-09-21", to: "2026-09-23" });
  });

  it("ends a weekly window six days after the week it closes on", () => {
    expect(windowFromIndices(days, 0, 1, "week")).toEqual({
      from: "2026-09-20",
      to: "2026-09-27",
    });
  });

  it("clamps a drag that ran past either edge, and has nothing for no days", () => {
    expect(windowFromIndices(days, -4, 99, "day")).toEqual({ from: days[0], to: days[4] });
    expect(windowFromIndices([], 0, 0, "day")).toBeNull();
  });

  it("finds the points a window covers", () => {
    expect(indicesFromWindow(days, { from: "2026-09-21", to: "2026-09-23" }, "day")).toEqual([
      1, 3,
    ]);
    expect(indicesFromWindow(days, { from: "2027-01-01", to: "2027-01-02" }, "day")).toBeNull();
  });

  it("counts a weekly point as covered by any day of its week", () => {
    const weeks = ["2026-09-07", "2026-09-14", "2026-09-21"];
    expect(indicesFromWindow(weeks, { from: "2026-09-16", to: "2026-09-16" }, "week")).toEqual([
      1, 1,
    ]);
  });

  it("slices the raw days half-open, and keeps everything for no window", () => {
    expect(sliceRange(days, { from: "2026-09-21", to: "2026-09-23" })).toEqual([1, 4]);
    expect(sliceRange(days, null)).toEqual([0, 5]);
    expect(sliceRange(days, { from: "2030-01-01", to: "2030-02-01" })).toEqual([0, 0]);
  });
});

describe("windowData", () => {
  const window = { from: "2026-09-21", to: "2026-09-23" };

  it("cuts every parallel array of a trend by the same days", () => {
    const trend: MetricTrend = {
      metric: "resting_hr",
      days,
      values: [1, 2, 3, 4, 5],
      roll7: [1, 2, 3, 4, 5],
      roll28: [1, 2, 3, 4, 5],
      roll90: [1, 2, 3, 4, 5],
      latest: 5,
      baseline_mean: 3,
      baseline_sd: 1,
      z: 0,
      flagged: false,
      verdict: "normal",
    };
    const cut = windowTrend(trend, window);
    expect(cut.days).toEqual(days.slice(1, 4));
    expect(cut.values).toEqual([2, 3, 4]);
    expect(cut.roll28).toEqual([2, 3, 4]);
    expect(windowTrend(trend, null)).toBe(trend);
  });

  it("cuts rows and readiness points by their day", () => {
    const rows = days.map((day) => ({ day, bb_high: 1, bb_low: 0 })) as DailyRow[];
    const points: ReadinessPoint[] = days.map((day) => ({ day, score: 50, band: "ready" }));
    expect(windowRows(rows, window).map((row) => row.day)).toEqual(days.slice(1, 4));
    expect(windowReadiness(points, window).map((point) => point.day)).toEqual(days.slice(1, 4));
  });

  it("cuts the body series, fat percentage included", () => {
    const body: BodySeries = {
      days,
      weight_kg: [70, 71, 72, 73, 74],
      trend_kg: [70, 70.5, 71, 71.5, 72],
      fat_kg: [10, 10, 10, 10, 10],
      lean_kg: [60, 61, 62, 63, 64],
      fat_pct: [14, 14, 14, 14, 14],
    };
    const cut = windowBody(body, window);
    expect(cut.weight_kg).toEqual([71, 72, 73]);
    expect(cut.fat_pct).toEqual([14, 14, 14]);
  });
});

describe("rangeStats", () => {
  it("measures movement from the first present value to the last", () => {
    expect(movement([null, 4, 9, null, 6])).toBe(2);
    expect(movement([null, null])).toBeNull();
  });

  it("summarises a metric from its daily values, with the baseline's change", () => {
    const trend = {
      days: days.slice(0, 3),
      values: [60, null, 56],
      roll7: [60, 60, 58],
      roll28: [60, 60, 58],
      roll90: [60, 60, 58],
    } as MetricTrend;
    expect(summarizeMetric(trend, RESTING_HR_METRIC)).toEqual([
      { label: "Readings", value: "2" },
      { label: "Avg", value: "58 bpm" },
      { label: "Low", value: "56 bpm" },
      { label: "High", value: "60 bpm" },
      { label: "28-day change", value: "−2 bpm" },
    ]);
  });

  it("does not invent numbers for a window with none", () => {
    const stats = summarizeReadiness([{ day: days[0] ?? "", score: null, band: null }]);
    expect(stats.map((stat) => stat.value)).toEqual(["0", "–", "–", "–"]);
  });

  it("summarises sleep, battery and readiness", () => {
    const rows = [
      {
        day: days[0],
        bb_high: 80,
        bb_low: 20,
        total_sleep_s: 28800,
        deep_s: 3600,
        rem_s: 7200,
        light_s: 18000,
      },
      {
        day: days[1],
        bb_high: 60,
        bb_low: 10,
        total_sleep_s: 25200,
        deep_s: 3600,
        rem_s: 3600,
        light_s: 18000,
      },
    ] as DailyRow[];
    expect(summarizeBodyBattery(rows)).toEqual([
      { label: "Avg high", value: "70" },
      { label: "Avg low", value: "15" },
      { label: "Best high", value: "80" },
      { label: "Worst low", value: "10" },
    ]);
    expect(summarizeSleep(rows)[0]).toEqual({ label: "Nights", value: "2" });
    expect(summarizeReadiness([{ day: days[0] ?? "", score: 40, band: "low" }])[1]).toEqual({
      label: "Avg",
      value: "40",
    });
  });

  it("summarises the body series, rebasing mass change to the window's first day", () => {
    const body: BodySeries = {
      days: days.slice(0, 3),
      weight_kg: [76, null, 75],
      trend_kg: [76, 75.5, 75],
      fat_kg: [14, 13.5, 13],
      lean_kg: [62, 62, 62.5],
      fat_pct: [18, 17.5, 17],
    };
    expect(summarizeWeight(body).at(-1)).toEqual({ label: "Trend change", value: "−1.0 kg" });
    expect(summarizeFatPct(body).at(-1)).toEqual({ label: "Change", value: "−1.0 pts" });
    expect(summarizeMass(body).map((stat) => stat.value)).toEqual([
      "+0.5 kg",
      "−1.0 kg",
      "62.5 kg",
      "13.0 kg",
    ]);
  });
});

describe("tooltip html", () => {
  it("escapes what it is given, because a label may carry markup", () => {
    const html = tooltipHtml(
      { heading: "<b>Sep 24</b>", rows: [{ label: "A&B", value: "<1>" }] },
      tokens,
    );
    expect(html).not.toContain("<b>Sep");
    expect(html).toContain("&lt;b&gt;Sep 24&lt;/b&gt;");
    expect(html).toContain("A&amp;B");
    expect(html).toContain("&lt;1&gt;");
  });

  it("draws a swatch only for a row that has a colour", () => {
    const html = tooltipHtml(
      {
        heading: "Sep 24",
        rows: [
          { label: "With", value: "1", color: "#123456" },
          { label: "Without", value: "2" },
        ],
      },
      tokens,
    );
    expect(html.match(/border-radius:50%/g)).toHaveLength(1);
    expect(html).toContain("#123456");
  });

  it("reads the hovered index off either shape ECharts passes", () => {
    expect(hoveredIndex([{ dataIndex: 3 }])).toBe(3);
    expect(hoveredIndex({ dataIndex: 2 })).toBe(2);
    expect(hoveredIndex([])).toBeNull();
    expect(hoveredIndex(undefined)).toBeNull();
  });
});

describe("zoomKey", () => {
  it("changes when the range does, and only then", () => {
    expect(zoomKey(days)).toBe(zoomKey([...days]));
    expect(zoomKey(days)).not.toBe(zoomKey(days.slice(1)));
    expect(zoomKey([])).toBe("||0");
  });
});
