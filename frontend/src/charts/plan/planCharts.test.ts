import type { LineSeriesOption } from "echarts/charts";
import { describe, expect, it } from "vitest";
import {
  buildWeeklyKmOption,
  type WeeklyKmWeek,
  weeklyKmTooltip,
} from "@/charts/plan/buildWeeklyKmOption";
import { colorTokens } from "@/design/tokens";

const tokens = colorTokens.light;
const today = new Date(2026, 9, 8);

const unprescribed: WeeklyKmWeek = { start: "2026-09-21", km: 18.4, plannedKm: null };
const followed: WeeklyKmWeek = { start: "2026-09-28", km: 24.1, plannedKm: 25.2 };
const weeks: WeeklyKmWeek[] = [
  unprescribed,
  followed,
  { start: "2026-10-05", km: 7.2, plannedKm: 28.4 },
  { start: "2026-10-12", km: 0, plannedKm: 30.6 },
];

function seriesOf(option: ReturnType<typeof buildWeeklyKmOption>) {
  const series = option.series;
  return Array.isArray(series) ? series : [];
}

/** The prescription line, narrowed so its line-only options can be read. */
function plannedLine(option: ReturnType<typeof buildWeeklyKmOption>): LineSeriesOption | undefined {
  return seriesOf(option).find((s): s is LineSeriesOption => s.type === "line");
}

describe("buildWeeklyKmOption", () => {
  const option = buildWeeklyKmOption({ weeks, tokens, today });

  it("draws what was run as bars and what was asked for as a line", () => {
    const [ran, planned] = seriesOf(option);
    expect(ran?.type).toBe("bar");
    expect(ran?.data).toEqual([18.4, 24.1, 7.2, 0]);
    expect(planned?.type).toBe("line");
    expect(planned?.data).toEqual([null, 25.2, 28.4, 30.6]);
  });

  it("keeps one y-axis: both series are kilometres", () => {
    expect(Array.isArray(option.yAxis)).toBe(false);
  });

  it("uses the run colour for the bars, never a literal", () => {
    expect(seriesOf(option)[0]?.color).toBe(tokens.kind.run);
  });

  it("omits the line entirely with no plan, rather than drawing a goal of zero", () => {
    const bare = buildWeeklyKmOption({
      weeks: weeks.map((w) => ({ ...w, plannedKm: null })),
      tokens,
    });
    expect(seriesOf(bare)).toHaveLength(1);
  });

  it("does not join the gap where the plan said nothing", () => {
    expect(plannedLine(option)?.connectNulls).toBe(false);
  });

  it("steps the prescription, because a plan changes on Mondays", () => {
    expect(plannedLine(option)?.step).toBe("middle");
  });
});

describe("weeklyKmTooltip", () => {
  it("says both numbers in one line", () => {
    expect(weeklyKmTooltip(followed, today)).toBe("Week of Sep 28 · 24.1 km run, 25.2 planned");
  });

  it("does not imply a prescription where there was none", () => {
    expect(weeklyKmTooltip(unprescribed, today)).toContain("nothing prescribed");
  });
});
