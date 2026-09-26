import { describe, expect, it } from "vitest";
import {
  buildMonthlyDistanceOption,
  monthlyDistanceScale,
  monthlyDistanceTooltip,
} from "@/charts/aggregate/buildMonthlyDistanceOption";
import { colorTokens } from "@/design/tokens";
import type { MonthPoint } from "@/features/trends/monthlySeries";

const tokens = colorTokens.light;

const points: MonthPoint[] = [
  { period: "2026-01", distanceM: 50_000 },
  { period: "2026-02", distanceM: null },
  { period: "2026-03", distanceM: 42_400 },
];

function seriesOf(option: { series?: unknown }): Record<string, unknown>[] {
  return Array.isArray(option.series) ? (option.series as Record<string, unknown>[]) : [];
}

describe("monthlyDistanceScale", () => {
  it("puts the top of the axis on a round number of kilometres above the peak", () => {
    const scale = monthlyDistanceScale(points);
    expect(scale.max).toBeGreaterThanOrEqual(50_000);
    expect(scale.max % scale.step).toBe(0);
    expect(scale.max / scale.step).toBeLessThanOrEqual(3);
  });

  it("still gives an axis when there is nothing on it", () => {
    const scale = monthlyDistanceScale([{ period: "2026-01", distanceM: null }]);
    expect(scale.max).toBeGreaterThan(0);
    expect(scale.step).toBeGreaterThan(0);
  });
});

describe("buildMonthlyDistanceOption", () => {
  const option = buildMonthlyDistanceOption({ points, tokens });

  it("draws one bar a month in metres, with a hole where nothing was recorded", () => {
    expect(seriesOf(option)[0]?.data).toEqual([50_000, null, 42_400]);
    expect(seriesOf(option)).toHaveLength(1);
    expect(option.legend).toBeUndefined();
  });

  it("keeps the months on the category axis, every one of them", () => {
    const axis = option.xAxis as { data?: unknown };
    expect(axis.data).toEqual(["2026-01", "2026-02", "2026-03"]);
  });

  it("carries 'km' once, on the top tick, and bare numbers below it", () => {
    const scale = monthlyDistanceScale(points);
    const axis = option.yAxis as { axisLabel?: { formatter?: (v: number) => string } };
    expect(axis.axisLabel?.formatter?.(scale.max)).toContain("km");
    expect(axis.axisLabel?.formatter?.(scale.step)).toBe(String(scale.step / 1000));
  });

  it("names the month and its distance in the tooltip, and the gap as a gap", () => {
    expect(monthlyDistanceTooltip(points[0] as MonthPoint)).toBe("Jan 2026 · 50.0 km");
    expect(monthlyDistanceTooltip(points[1] as MonthPoint)).toBe("Feb 2026 · –");
  });
});
