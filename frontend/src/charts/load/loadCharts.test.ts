import { describe, expect, it } from "vitest";
import type { components } from "@/api/schema";
import { buildFitnessChartOption, fitnessTooltip } from "@/charts/load/buildFitnessChartOption";
import { buildWeeklyLoadOption, weeklyLoadTooltip } from "@/charts/load/buildWeeklyLoadOption";
import { colorTokens } from "@/design/tokens";

type LoadDay = components["schemas"]["LoadDay"];
type LoadWeek = components["schemas"]["LoadWeek"];

const tokens = colorTokens.light;
const today = new Date(2026, 8, 24);

const days: LoadDay[] = Array.from({ length: 200 }, (_, i) => ({
  day: `2026-${String(3 + Math.floor(i / 30)).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`,
  load: i,
  ctl: 50 + i / 10,
  atl: 55 + i / 8,
  tsb: -4.9,
}));

const weeks: LoadWeek[] = Array.from({ length: 20 }, (_, i) => ({
  week: `2026-W${i + 1}`,
  start: "2026-09-14",
  load: 400 + i,
  ctl_end: 80,
  atl_end: 85,
  tsb_end: -5,
  delta_pct: null,
  ctl_delta_pct: null,
  overreaching: false,
}));

function seriesOf(option: ReturnType<typeof buildFitnessChartOption>) {
  const series = option.series;
  return Array.isArray(series) ? series : [];
}

describe("buildFitnessChartOption", () => {
  const option = buildFitnessChartOption({ curve: days, tokens, today });

  it("shows the last 120 days of fitness and fatigue on one axis", () => {
    const [fitness, fatigue] = seriesOf(option);
    expect(fitness?.data).toHaveLength(120);
    expect(fatigue?.data).toHaveLength(120);
    expect(Array.isArray(option.yAxis)).toBe(false);
  });

  it("tells the lines apart by ink and weight, not colour", () => {
    const [fitness, fatigue] = seriesOf(option);
    expect(fitness?.color).toBe(tokens.ink);
    expect(fatigue?.color).toBe(tokens.inkMuted);
    expect(option.legend).toBeUndefined();
  });

  it("formats the tooltip through the shared helpers", () => {
    const day = days[0];
    expect(day && fitnessTooltip(day, today)).toBe(
      "Mar 1 · Fitness 50.0 · Fatigue 55.0 · Form −4.9",
    );
  });
});

describe("buildWeeklyLoadOption", () => {
  const option = buildWeeklyLoadOption({ weeks, tokens, today });

  it("shows the last 12 weeks as neutral bars", () => {
    const series = Array.isArray(option.series) ? option.series : [];
    expect(series[0]?.type).toBe("bar");
    expect(series[0]?.data).toHaveLength(12);
    expect(series[0]?.color).toBe(tokens.inkSecondary);
  });

  it("formats the tooltip", () => {
    const week = weeks[0];
    expect(week && weeklyLoadTooltip(week, today)).toBe("Week of Sep 14 · 400");
  });
});
