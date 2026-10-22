import { describe, expect, it } from "vitest";
import type { DailyRow, MetricTrend, ReadinessPoint } from "@/api/queries/useHealth";
import {
  DAILY_UP_TO_DAYS,
  dayHeading,
  resolutionFor,
  resolveReadiness,
  resolveRows,
  resolveTrend,
} from "@/charts/health/resolution";

const today = new Date(2026, 8, 24);

function daysFrom(start: string, count: number): string[] {
  const first = Date.parse(`${start}T00:00:00Z`);
  return Array.from({ length: count }, (_, i) =>
    new Date(first + i * 86_400_000).toISOString().slice(0, 10),
  );
}

function trendOf(values: (number | null)[], roll28 = values): MetricTrend {
  return {
    metric: "hrv",
    days: daysFrom("2026-09-01", values.length),
    values,
    roll7: values,
    roll28,
    roll90: values,
    latest: null,
    baseline_mean: null,
    baseline_sd: null,
    z: null,
    flagged: false,
    verdict: "normal",
  };
}

describe("resolutionFor", () => {
  it("keeps a quarter a point a day, and draws longer windows by the week", () => {
    expect(resolutionFor(DAILY_UP_TO_DAYS)).toBe("day");
    expect(resolutionFor(DAILY_UP_TO_DAYS + 1)).toBe("week");
    expect(resolutionFor(0)).toBe("day");
  });
});

describe("dayHeading", () => {
  it("says a point is a week when it is one", () => {
    expect(dayHeading("2026-09-23", "day", today)).toBe("Sep 23");
    expect(dayHeading("2026-09-23", "week", today)).toBe("Week of Sep 23");
  });
});

describe("resolveTrend", () => {
  it("returns the window untouched at daily resolution", () => {
    const trend = trendOf([1, 2, 3]);
    expect(resolveTrend(trend, "day")).toBe(trend);
  });

  it("averages each week and counts the weeks back from the newest day", () => {
    // 16 days: the newest two weeks are whole, the oldest holds the two left over.
    const values = Array.from({ length: 16 }, (_, i) => i + 1);
    const weekly = resolveTrend(trendOf(values), "week");
    expect(weekly.values).toEqual([1.5, 6, 13]);
    expect(weekly.days).toEqual(["2026-09-01", "2026-09-03", "2026-09-10"]);
  });

  it("averages the readings present, and leaves a week with none as a gap", () => {
    const values = [...Array<number | null>(7).fill(null), 10, null, 20, ...Array(4).fill(null)];
    expect(resolveTrend(trendOf(values), "week").values).toEqual([null, 15]);
  });

  it("takes the baseline as it stood at the close of the week, not a mean of baselines", () => {
    const values = Array.from({ length: 14 }, (_, i) => i);
    const roll28 = values.map((value) => value * 10);
    expect(resolveTrend(trendOf(values, roll28), "week").roll28).toEqual([60, 130]);
  });

  it("keeps the points a week stands for the same length across every series", () => {
    const weekly = resolveTrend(trendOf(Array.from({ length: 30 }, (_, i) => i)), "week");
    expect(weekly.values).toHaveLength(weekly.days.length);
    expect(weekly.roll28).toHaveLength(weekly.days.length);
    expect(weekly.roll7).toHaveLength(weekly.days.length);
    expect(weekly.roll90).toHaveLength(weekly.days.length);
  });
});

describe("resolveRows", () => {
  const rows = daysFrom("2026-09-01", 14).map((day, i) => ({
    day,
    bb_high: 50 + i,
    bb_low: i % 2 === 0 ? 10 : null,
    deep_s: 3600,
    rem_s: 5400,
    light_s: 18000,
    total_sleep_s: 27000,
  })) as DailyRow[];

  it("averages what the sleep and Body Battery charts read", () => {
    const weekly = resolveRows(rows, "week");
    expect(weekly.map((row) => row.day)).toEqual(["2026-09-01", "2026-09-08"]);
    expect(weekly.map((row) => row.bb_high)).toEqual([53, 60]);
    expect(weekly[0]?.bb_low).toBe(10);
    expect(weekly[0]?.deep_s).toBe(3600);
  });

  it("returns a copy at daily resolution", () => {
    const daily = resolveRows(rows, "day");
    expect(daily).toEqual(rows);
    expect(daily).not.toBe(rows);
  });
});

describe("resolveReadiness", () => {
  const series: ReadinessPoint[] = daysFrom("2026-09-01", 14).map((day, i) => ({
    day,
    score: i < 7 ? 60 : 80,
    band: "ready",
  }));

  it("averages a week's score and drops the band it cannot honestly name", () => {
    expect(resolveReadiness(series, "week")).toEqual([
      { day: "2026-09-01", score: 60, band: null },
      { day: "2026-09-08", score: 80, band: null },
    ]);
  });
});
