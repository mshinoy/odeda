import { describe, expect, it } from "vitest";
import type { DailyRow, MetricTrend, ReadinessPoint } from "@/api/queries/useHealth";
import {
  bodyBatteryDays,
  bodyBatteryTooltip,
  buildBodyBatteryOption,
} from "@/charts/health/buildBodyBatteryOption";
import {
  BASELINE_LABEL,
  buildMetricTrendOption,
  metricTrendScale,
  metricTrendTooltip,
} from "@/charts/health/buildMetricTrendOption";
import { buildReadinessOption, readinessTooltip } from "@/charts/health/buildReadinessOption";
import {
  buildSleepStagesOption,
  SLEEP_STAGES,
  sleepAxisMaxH,
  sleepNightTooltip,
  sleepStageColors,
} from "@/charts/health/buildSleepStagesOption";
import type { TooltipCard } from "@/charts/chrome";
import { HEALTH_GUTTERS } from "@/charts/health/dayAxis";
import { colorTokens } from "@/design/tokens";
import { RESTING_HR_METRIC, SLEEP_SCORE_METRIC } from "@/features/health/healthMetrics";
import type { SleepNight } from "@/features/health/sleepStages";

const tokens = colorTokens.light;
const today = new Date(2026, 8, 24);

const nights: SleepNight[] = [
  { day: "2026-09-22", deepH: null, remH: null, lightH: null },
  { day: "2026-09-23", deepH: 0.15, remH: 2.0166666666666666, lightH: 5.8 },
  { day: "2026-09-24", deepH: 0, remH: 0.5833333333333334, lightH: 7.133333333333334 },
];

const restingHrTrend: MetricTrend = {
  metric: "resting_hr",
  days: ["2026-09-22", "2026-09-23", "2026-09-24"],
  values: [62, null, 56],
  roll7: [62, 62, 59],
  roll28: [62, 62, 59],
  roll90: [62, 62, 59],
  latest: 56,
  baseline_mean: 58.11,
  baseline_sd: 3.26,
  z: -0.65,
  flagged: false,
  verdict: "normal",
};

function seriesOf(option: { series?: unknown }): Record<string, unknown>[] {
  return Array.isArray(option.series) ? (option.series as Record<string, unknown>[]) : [];
}

/** A tooltip card as one readable line per row, heading first. */
function lines(card: TooltipCard | null): string[] {
  return card === null
    ? []
    : [card.heading, ...card.rows.map((row) => `${row.label}: ${row.value}`)];
}

describe("buildSleepStagesOption", () => {
  const option = buildSleepStagesOption({ nights, tokens, today });

  it("stacks the three stages into one bar per night, deep at the base", () => {
    const series = seriesOf(option);
    expect(series.map((s) => s.name)).toEqual(["Deep", "REM", "Light"]);
    expect(new Set(series.map((s) => s.stack))).toEqual(new Set(["night"]));
    expect(series.every((s) => s.type === "bar")).toBe(true);
    expect(Array.isArray(option.yAxis)).toBe(false);
  });

  it("colours the stages by depth, from the one magnitude ramp", () => {
    const colors = sleepStageColors(tokens);
    expect(colors.deep).toBe(tokens.metricRamp.at(-1));
    expect(colors.light).toBe(tokens.metricRamp[0]);
    expect(seriesOf(option).map((s) => s.color)).toEqual([colors.deep, colors.rem, colors.light]);
    expect(SLEEP_STAGES.map((stage) => stage.label)).toEqual(["Deep", "REM", "Light"]);
  });

  it("rounds the axis up to a whole tick, and never below 8 hours", () => {
    // The longest night here is 7.97 h, which rounds up to the 8 h floor.
    expect(sleepAxisMaxH(nights)).toBe(8);
    expect(sleepAxisMaxH([{ day: "d", deepH: 2, remH: 3, lightH: 5 }])).toBe(12);
    expect(sleepAxisMaxH([])).toBe(8);
  });

  it("names every stage in the tooltip, because a stack cannot be read off the bar", () => {
    expect(lines(nights[1] ? sleepNightTooltip(nights[1], today) : null)).toEqual([
      "Sep 23",
      "Total: 8.0 h",
      "Deep: 0.2 h",
      "REM: 2.0 h",
      "Light: 5.8 h",
    ]);
    expect(lines(nights[0] ? sleepNightTooltip(nights[0], today) : null)).toEqual([
      "Sep 22",
      "Total: –",
      "Deep: –",
      "REM: –",
      "Light: –",
    ]);
  });
});

describe("buildMetricTrendOption", () => {
  const option = buildMetricTrendOption({
    trend: restingHrTrend,
    metric: RESTING_HR_METRIC,
    tokens,
    today,
  });

  it("draws the daily reading and its 28-day baseline on one axis", () => {
    const [daily, baseline] = seriesOf(option);
    expect(daily?.data).toEqual([62, null, 56]);
    expect(baseline?.data).toEqual([62, 62, 59]);
    expect(Array.isArray(option.yAxis)).toBe(false);
    expect(option.legend).toBeUndefined();
  });

  it("tells them apart by ink and weight, and labels the baseline at its end", () => {
    const [daily, baseline] = seriesOf(option);
    expect(daily?.color).toBe(tokens.inkMuted);
    expect(baseline?.color).toBe(tokens.ink);
    expect(baseline?.endLabel).toMatchObject({ formatter: BASELINE_LABEL });
  });

  it("leaves a gap where the watch recorded nothing", () => {
    // Both lines: a 28-day mean goes null only after 28 blank days, and joining
    // across that would draw a baseline for a month with nothing behind it.
    expect(seriesOf(option)[0]?.connectNulls).toBe(false);
    expect(seriesOf(option)[1]?.connectNulls).toBe(false);
  });

  it("reads sleep in hours, so the axis is hours and not seconds", () => {
    const sleep = buildMetricTrendOption({
      trend: { ...restingHrTrend, metric: "total_sleep_s", values: [25200, null, 28800] },
      metric: { ...SLEEP_SCORE_METRIC, key: "total_sleep_s", scale: 1 / 3600, unit: "h" },
      tokens,
      today,
    });
    expect(seriesOf(sleep)[0]?.data).toEqual([7, null, 8]);
  });

  it("puts the bounds on round values, with a floor under the span", () => {
    // 56..62 is a 6 bpm spread; `minSpan` 10 widens it, and the step rounds it out.
    const scale = metricTrendScale([56, null, 62], RESTING_HR_METRIC);
    expect(scale).not.toBeNull();
    expect(scale && scale.max - scale.min).toBeGreaterThanOrEqual(10);
    expect(scale && scale.min % scale.step).toBe(0);
    expect(metricTrendScale([null, null], RESTING_HR_METRIC)).toBeNull();
  });

  it("never runs the axis below a floor that padding would have crossed", () => {
    // 1,200..4,000 steps is a wide spread whose padded bottom would have gone negative.
    const steps = { ...RESTING_HR_METRIC, minSpan: 4000, floor: 0 };
    expect(metricTrendScale([1200, 4000], steps)?.min).toBe(0);
    expect(metricTrendScale([1200, 4000], { ...steps, floor: undefined })?.min).toBeLessThan(1200);
  });

  it("heads a weekly point as the week it opens", () => {
    const card = metricTrendTooltip(restingHrTrend, RESTING_HR_METRIC, 2, today, "week");
    expect(card?.heading).toBe("Week of Sep 24");
  });

  it("puts the value, the baseline and the gap between them in the tooltip", () => {
    expect(lines(metricTrendTooltip(restingHrTrend, RESTING_HR_METRIC, 2, today))).toEqual([
      "Sep 24",
      "Resting HR: 56 bpm",
      "28-day: 59 bpm",
      "vs 28-day: \u22123 bpm",
    ]);
    expect(lines(metricTrendTooltip(restingHrTrend, RESTING_HR_METRIC, 1, today))).toEqual([
      "Sep 23",
      "Resting HR: –",
      "28-day: 62 bpm",
      "vs 28-day: –",
    ]);
  });

  it("has no tooltip for a point that is not on the chart", () => {
    expect(metricTrendTooltip(restingHrTrend, RESTING_HR_METRIC, 9, today)).toBeNull();
  });

  it("swatches each row in the colour of its line", () => {
    const card = metricTrendTooltip(restingHrTrend, RESTING_HR_METRIC, 2, today, "day", tokens);
    expect(card?.rows.map((row) => row.color)).toEqual([tokens.inkMuted, tokens.ink, undefined]);
  });
});

describe("buildBodyBatteryOption", () => {
  const rows = [
    { day: "2026-09-23", bb_high: 61, bb_low: 10 },
    { day: "2026-09-24", bb_high: 67, bb_low: 13 },
  ] as DailyRow[];
  const option = buildBodyBatteryOption({ rows, tokens, today });

  it("plots the day's peak and trough on one 0-100 axis", () => {
    const [high, low] = seriesOf(option);
    expect(high?.data).toEqual([61, 67]);
    expect(low?.data).toEqual([10, 13]);
    expect(option.yAxis).toMatchObject({ min: 0, max: 100 });
    expect(Array.isArray(option.yAxis)).toBe(false);
  });

  it("names both ends in the tooltip and at the line's end", () => {
    expect(lines(rows[1] ? bodyBatteryTooltip(rows[1], today) : null)).toEqual([
      "Sep 24",
      "High: 67",
      "Low: 13",
      "Range: 54",
    ]);
    expect(seriesOf(option).map((s) => s.name)).toEqual(["High", "Low"]);
  });

  it("heads a weekly point as the week it opens", () => {
    expect(rows[1] && bodyBatteryTooltip(rows[1], today, "week").heading).toBe("Week of Sep 24");
  });

  it("knows when there is nothing to draw", () => {
    expect(bodyBatteryDays(rows)).toBe(true);
    expect(bodyBatteryDays([{ day: "d", bb_high: null, bb_low: null } as DailyRow])).toBe(false);
  });
});

describe("buildReadinessOption", () => {
  const series: ReadinessPoint[] = [
    { day: "2026-09-23", score: 69.7, band: "ready" },
    { day: "2026-09-24", score: 45.3, band: "low" },
  ];
  const option = buildReadinessOption({ series, tokens, today });

  it("plots the score on the same 0-100 scale the Status page uses", () => {
    expect(seriesOf(option)[0]?.data).toEqual([69.7, 45.3]);
    expect(option.yAxis).toMatchObject({ min: 0, max: 100 });
  });

  it("keeps the band as a label in the tooltip, not as a colour on the line", () => {
    expect(lines(series[1] ? readinessTooltip(series[1], today) : null)).toEqual([
      "Sep 24",
      "Score: 45",
      "Status: Low",
    ]);
    expect(seriesOf(option)[0]?.color).toBe(tokens.ink);
  });

  it("leaves the band off a week's mean, which has none", () => {
    expect(lines(series[1] ? readinessTooltip(series[1], today, "week") : null)).toEqual([
      "Week of Sep 24",
      "Score: 45",
    ]);
  });
});

describe("day axis labels", () => {
  function labels(days: string[]): string[] {
    const axis = buildMetricTrendOption({
      trend: { ...restingHrTrend, days, values: days.map(() => 60) },
      metric: RESTING_HR_METRIC,
      tokens,
      today,
    }).xAxis as { axisLabel: { formatter: (value: string) => string } };
    return days.map((day) => axis.axisLabel.formatter(day));
  }

  it("reads a short window as day and month", () => {
    expect(labels(["2026-09-22", "2026-09-24"])).toEqual(["Sep 22", "Sep 24"]);
  });

  it("reads a window of more than eight months as month and year", () => {
    expect(labels(["2025-01-05", "2026-09-24"])).toEqual(["Jan 2025", "Sep 2026"]);
  });
});

describe("zoom and selection", () => {
  it("leave dataZoom out of the option, because the page owns the window", () => {
    // Zoom is a slice of the data before the build, so y rescales; a dataZoom here would
    // fight it, and would not rescale y at all.
    const option = buildMetricTrendOption({
      trend: restingHrTrend,
      metric: RESTING_HR_METRIC,
      tokens,
      today,
    });
    expect("dataZoom" in option).toBe(false);
  });

  it("shares the gutters the selection overlay is positioned from", () => {
    const grid = buildMetricTrendOption({
      trend: restingHrTrend,
      metric: RESTING_HR_METRIC,
      tokens,
      today,
    }).grid as { left: number; right: number };
    expect(grid.left).toBe(HEALTH_GUTTERS.left);
    expect(grid.right).toBe(HEALTH_GUTTERS.right);
  });
});
