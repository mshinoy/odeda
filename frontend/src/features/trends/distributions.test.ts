import { describe, expect, it } from "vitest";
import type { components } from "@/api/schema";
import { buildHistogramOption, histogramTooltip } from "@/charts/aggregate/buildHistogramOption";
import { colorTokens } from "@/design/tokens";
import { dayHourCells, formatHour, hasDayHourData, HOURS_PER_DAY } from "@/features/trends/dayHour";
import {
  bucketedCount,
  coverageNote,
  DISTANCE_HISTOGRAM,
  HR_HISTOGRAM,
  PACE_HISTOGRAM,
  zoneCoverageNote,
  zoneTimes,
} from "@/features/trends/distributions";

type HistogramBucket = components["schemas"]["HistogramBucket"];
type Patterns = components["schemas"]["Patterns"];

const tokens = colorTokens.light;

const paceBuckets: HistogramBucket[] = [
  { lo: 300, hi: 315, count: 12 },
  { lo: 315, hi: 330, count: 30 },
  { lo: 330, hi: 345, count: 1 },
];

function weekdays(): Patterns["day_of_week"] {
  return ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((name, day) => ({
    day,
    name,
    count: 0,
    distance_km: 0,
    hours: 0,
  }));
}

function patternsWith(matrix: number[][]): Patterns {
  return {
    day_of_week: weekdays(),
    hour_of_day: [],
    month_of_year: [],
    dow_hour_matrix: matrix,
    busiest_day: "Mon",
    peak_hour: 20,
    total: matrix.reduce((sum, row) => sum + row.reduce((a, b) => a + b, 0), 0),
  };
}

const emptyWeek = () => Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));

/** A 7 × 24 matrix with counts only where `busy` puts them. */
function weekWith(busy: Record<string, number>): number[][] {
  return Array.from({ length: 7 }, (_, day) =>
    Array.from({ length: 24 }, (_, hour) => busy[`${day}-${hour}`] ?? 0),
  );
}

describe("histogram specs", () => {
  it("reads a pace bucket in minutes per kilometre, with the unit once", () => {
    expect(PACE_HISTOGRAM.formatTick(300)).toBe("5:00");
    expect(PACE_HISTOGRAM.formatRange(300, 315)).toBe("5:00–5:15 /km");
  });

  it("reads a distance bucket in km and an HR bucket in bpm", () => {
    expect(DISTANCE_HISTOGRAM.formatRange(5, 7)).toBe("5–7 km");
    expect(HR_HISTOGRAM.formatRange(120, 130)).toBe("120–130 bpm");
  });
});

describe("coverageNote", () => {
  it("owns up to the activities that had nothing to bucket", () => {
    // A gym session has no pace and no distance, so it is in `sample_size` and in no bar.
    expect(bucketedCount(paceBuckets)).toBe(43);
    expect(coverageNote(paceBuckets, 488)).toBe("43 of 488 activities");
  });

  it("says only the count when every activity is in there", () => {
    expect(coverageNote(paceBuckets, 43)).toBe("43 activities");
  });
});

describe("zoneCoverageNote", () => {
  it("sets the zone time against all the moving time, so a thin sample shows", () => {
    // Garmin sent zones for ten of 488 activities: 6.5 h against 409 h of training.
    expect(zoneCoverageNote(23_619, 1_472_776)).toBe("6:33:39 of 409 h");
  });

  it("says only the time when there is no moving time to set it against", () => {
    expect(zoneCoverageNote(23_619, 0)).toBe("6:33:39");
  });
});

describe("zoneTimes", () => {
  it("keeps the zones with time in them, and drops the ones with none", () => {
    expect(
      zoneTimes([
        { zone: 1, seconds: 9344.3, hours: 2.6, pct: 39.6 },
        { zone: 5, seconds: 0, hours: 0, pct: 0 },
      ]),
    ).toEqual([{ zone: 1, seconds: 9344.3 }]);
  });
});

describe("buildHistogramOption", () => {
  const option = buildHistogramOption({ buckets: paceBuckets, spec: PACE_HISTOGRAM, tokens });

  it("draws one bar a bucket, keyed on the bucket's low edge", () => {
    const series = Array.isArray(option.series) ? option.series : [];
    expect((series[0] as { data?: unknown }).data).toEqual([12, 30, 1]);
    expect((option.xAxis as { data?: unknown }).data).toEqual([300, 315, 330]);
  });

  it("never puts a tick between two whole activities", () => {
    expect((option.yAxis as { minInterval?: number }).minInterval).toBe(1);
  });

  it("names the range and the count in the tooltip, and counts one activity singly", () => {
    expect(histogramTooltip(paceBuckets[0] as HistogramBucket, PACE_HISTOGRAM)).toBe(
      "5:00–5:15 /km · 12 activities",
    );
    expect(histogramTooltip(paceBuckets[2] as HistogramBucket, PACE_HISTOGRAM)).toBe(
      "5:30–5:45 /km · 1 activity",
    );
  });
});

describe("dayHourCells", () => {
  it("lays out all 168 cells, Monday first", () => {
    const cells = dayHourCells(patternsWith(emptyWeek()));
    expect(cells).toHaveLength(7 * HOURS_PER_DAY);
    expect(cells[0]).toMatchObject({ day: 0, hour: 0 });
    expect(cells[HOURS_PER_DAY]).toMatchObject({ day: 1, hour: 0 });
  });

  it("scales against the busiest slot, so the regular ones read as full", () => {
    const matrix = weekWith({ "0-20": 25, "2-6": 5 });
    const byKey = new Map(
      dayHourCells(patternsWith(matrix)).map((cell) => [`${cell.day}-${cell.hour}`, cell]),
    );
    expect(byKey.get("0-20")?.intensity).toBe(1);
    expect(byKey.get("2-6")?.intensity).toBe(0.2);
    expect(byKey.get("1-1")?.intensity).toBe(0);
  });

  it("names the slot and its count for the cell's own title", () => {
    const cells = dayHourCells(patternsWith(weekWith({ "0-20": 25, "1-7": 1 })));
    expect(cells[20]?.title).toBe("Mon 20:00 · 25 activities");
    expect(cells[HOURS_PER_DAY + 7]?.title).toBe("Tue 07:00 · 1 activity");
  });

  it("does not divide by a peak of zero", () => {
    expect(dayHourCells(patternsWith(emptyWeek())).every((c) => c.intensity === 0)).toBe(true);
    expect(hasDayHourData(patternsWith(emptyWeek()))).toBe(false);
  });
});

describe("formatHour", () => {
  it("pads to a two-digit clock", () => {
    expect(formatHour(0)).toBe("00:00");
    expect(formatHour(20)).toBe("20:00");
  });
});
