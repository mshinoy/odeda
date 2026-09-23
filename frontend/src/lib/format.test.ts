import { describe, expect, it } from "vitest";
import {
  MISSING,
  formatDate,
  formatDateTime,
  formatDelta,
  formatDistance,
  formatDuration,
  formatElevation,
  formatHeartRate,
  formatPace,
  formatPercent,
  formatSpeed,
  formatSportSpeed,
  formatSwimPace,
  formatWeekday,
  paceFromSpeed,
} from "@/lib/format";

const missingInputs = [null, undefined, Number.NaN, Number.POSITIVE_INFINITY];

describe("missing values", () => {
  it.each([
    ["formatDistance", formatDistance],
    ["formatDuration", formatDuration],
    ["formatPace", formatPace],
    ["formatSpeed", formatSpeed],
    ["formatSwimPace", formatSwimPace],
    ["formatHeartRate", formatHeartRate],
    ["formatElevation", formatElevation],
    ["formatPercent", (value: number | null | undefined) => formatPercent(value)],
    ["formatDelta", (value: number | null | undefined) => formatDelta(value)],
  ])("%s renders the placeholder", (_name, format) => {
    for (const input of missingInputs) expect(format(input)).toBe(MISSING);
  });

  it("uses an en dash", () => {
    expect(MISSING).toBe("–");
  });
});

describe("formatDistance", () => {
  it("shows metres under a kilometre", () => {
    expect(formatDistance(0)).toBe("0 m");
    expect(formatDistance(850)).toBe("850 m");
    expect(formatDistance(849.6)).toBe("850 m");
    expect(formatDistance(999.4)).toBe("999 m");
  });

  it("switches to km when the rounded metres reach 1000", () => {
    expect(formatDistance(999.6)).toBe("1.0 km");
    expect(formatDistance(1000)).toBe("1.0 km");
  });

  it("shows one decimal below 100 km", () => {
    expect(formatDistance(10_234)).toBe("10.2 km");
    expect(formatDistance(10_250)).toBe("10.3 km");
    expect(formatDistance(42_195)).toBe("42.2 km");
    expect(formatDistance(99_940)).toBe("99.9 km");
  });

  it("drops decimals from 100 km, including values that round up to it", () => {
    expect(formatDistance(99_960)).toBe("100 km");
    expect(formatDistance(100_000)).toBe("100 km");
    expect(formatDistance(160_900)).toBe("161 km");
    expect(formatDistance(1_234_000)).toBe("1,234 km");
  });
});

describe("formatDuration", () => {
  it("uses m:ss under an hour", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(45)).toBe("0:45");
    expect(formatDuration(2770)).toBe("46:10");
    expect(formatDuration(3599)).toBe("59:59");
  });

  it("uses h:mm:ss from an hour", () => {
    expect(formatDuration(3600)).toBe("1:00:00");
    expect(formatDuration(3725)).toBe("1:02:05");
    expect(formatDuration(36_000)).toBe("10:00:00");
  });

  it("rounds to the second before splitting", () => {
    expect(formatDuration(59.6)).toBe("1:00");
    expect(formatDuration(3599.5)).toBe("1:00:00");
    expect(formatDuration(2770.4)).toBe("46:10");
  });

  it("keeps the sign of a negative duration", () => {
    expect(formatDuration(-65)).toBe("-1:05");
  });
});

describe("formatPace", () => {
  it("formats seconds per km as m:ss /km", () => {
    expect(formatPace(312)).toBe("5:12 /km");
    expect(formatPace(245)).toBe("4:05 /km");
  });

  it("rounds up into the next minute rather than showing :60", () => {
    expect(formatPace(359.6)).toBe("6:00 /km");
    expect(formatPace(359.4)).toBe("5:59 /km");
  });

  it("treats zero or negative pace as missing", () => {
    expect(formatPace(0)).toBe(MISSING);
    expect(formatPace(-300)).toBe(MISSING);
  });
});

describe("paceFromSpeed", () => {
  it("converts m/s to seconds per km", () => {
    expect(paceFromSpeed(3.2)).toBeCloseTo(312.5);
    expect(paceFromSpeed(4)).toBe(250);
  });

  it("returns null at or below walking-still speed", () => {
    expect(paceFromSpeed(0.5)).toBeNull();
    expect(paceFromSpeed(0.2)).toBeNull();
    expect(paceFromSpeed(0)).toBeNull();
    expect(paceFromSpeed(-1)).toBeNull();
    expect(paceFromSpeed(0.51)).not.toBeNull();
  });

  it("returns null for missing input", () => {
    for (const input of missingInputs) expect(paceFromSpeed(input)).toBeNull();
  });
});

describe("formatSpeed", () => {
  it("converts m/s to km/h with one decimal", () => {
    expect(formatSpeed(7.9)).toBe("28.4 km/h");
    expect(formatSpeed(0)).toBe("0.0 km/h");
    expect(formatSpeed(10)).toBe("36.0 km/h");
  });
});

describe("formatSwimPace", () => {
  it("formats time per 100 m", () => {
    expect(formatSwimPace(100 / 112)).toBe("1:52 /100m");
    expect(formatSwimPace(1)).toBe("1:40 /100m");
  });

  it("rounds up into the next minute rather than showing :60", () => {
    expect(formatSwimPace(100 / 119.7)).toBe("2:00 /100m");
  });

  it("keeps slow drill pace but treats near-zero speed as missing", () => {
    expect(formatSwimPace(0.4)).toBe("4:10 /100m");
    expect(formatSwimPace(0.2)).toBe(MISSING);
    expect(formatSwimPace(0)).toBe(MISSING);
  });
});

describe("formatSportSpeed", () => {
  it("uses pace on foot", () => {
    expect(formatSportSpeed(1000 / 312, "run")).toBe("5:12 /km");
    expect(formatSportSpeed(1000 / 600, "walk")).toBe("10:00 /km");
    expect(formatSportSpeed(0.3, "run")).toBe(MISSING);
  });

  it("uses km/h on a bike and for everything else", () => {
    expect(formatSportSpeed(7.9, "ride")).toBe("28.4 km/h");
    expect(formatSportSpeed(2, "other")).toBe("7.2 km/h");
    expect(formatSportSpeed(2, "strength")).toBe("7.2 km/h");
  });

  it("uses /100m in the water", () => {
    expect(formatSportSpeed(1, "swim")).toBe("1:40 /100m");
  });
});

describe("formatHeartRate and formatElevation", () => {
  it("round to whole numbers", () => {
    expect(formatHeartRate(148.4)).toBe("148 bpm");
    expect(formatHeartRate(147.5)).toBe("148 bpm");
    expect(formatElevation(312.2)).toBe("312 m");
    expect(formatElevation(1234)).toBe("1,234 m");
    expect(formatElevation(-12)).toBe("-12 m");
  });
});

describe("formatPercent", () => {
  it("takes values already in percent", () => {
    expect(formatPercent(12.4)).toBe("12%");
    expect(formatPercent(12.45, 1)).toBe("12.5%");
    expect(formatPercent(0, 1)).toBe("0.0%");
    expect(formatPercent(100)).toBe("100%");
  });
});

describe("formatDelta", () => {
  it("marks direction with an arrow", () => {
    expect(formatDelta(4.2)).toBe("▲ 4%");
    expect(formatDelta(-3)).toBe("▼ 3%");
    expect(formatDelta(-2.6)).toBe("▼ 3%");
  });

  it("shows no arrow when the change rounds to zero", () => {
    expect(formatDelta(0)).toBe("0%");
    expect(formatDelta(-0)).toBe("0%");
    expect(formatDelta(0.4)).toBe("0%");
    expect(formatDelta(-0.4)).toBe("0%");
  });

  it("supports decimals", () => {
    expect(formatDelta(1.25, 1)).toBe("▲ 1.3%");
    expect(formatDelta(0.04, 1)).toBe("0.0%");
  });
});

describe("dates", () => {
  const today = new Date(2026, 8, 23);

  it("formatDate omits the year in the current year", () => {
    expect(formatDate("2026-09-22", today)).toBe("Sep 22");
    expect(formatDate("2026-01-01", today)).toBe("Jan 1");
  });

  it("formatDate adds the year outside the current year", () => {
    expect(formatDate("2025-12-31", today)).toBe("Dec 31, 2025");
  });

  it("formatDate takes the calendar day as written, whatever the timezone", () => {
    // A late local start time must not slip to the next day.
    expect(formatDate("2026-09-22T23:30:00", today)).toBe("Sep 22");
    expect(formatDate("2026-09-22T00:05:00", today)).toBe("Sep 22");
  });

  it("formatDateTime shows 24-hour wall-clock time", () => {
    expect(formatDateTime("2026-09-22T07:15:00", today)).toBe("Sep 22, 07:15");
    expect(formatDateTime("2026-09-22T19:05", today)).toBe("Sep 22, 19:05");
    expect(formatDateTime("2025-03-01T06:00:00", today)).toBe("Mar 1, 2025, 06:00");
    expect(formatDateTime("2026-09-22", today)).toBe("Sep 22, 00:00");
  });

  it("formatWeekday gives the short weekday", () => {
    expect(formatWeekday("2026-09-22")).toBe("Tue");
    expect(formatWeekday("2026-09-27T23:59:00")).toBe("Sun");
  });

  it("renders missing or invalid dates as the placeholder", () => {
    for (const input of [null, undefined, "", "not a date", "2026-02-30", "2026-13-01"]) {
      expect(formatDate(input, today)).toBe(MISSING);
      expect(formatDateTime(input, today)).toBe(MISSING);
      expect(formatWeekday(input)).toBe(MISSING);
    }
  });
});
