import { describe, expect, it } from "vitest";
import {
  formatAgo,
  formatIn,
  formatCountRange,
  formatDays,
  formatRoughDuration,
  formatEfficiencyFactor,
  formatDecimal,
  formatInteger,
  formatRelative,
  formatSigned,
  formatSignedPercent,
  formatVo2max,
  MISSING,
  formatDate,
  formatDateTime,
  formatDelta,
  formatDistance,
  formatDuration,
  formatElevation,
  formatExerciseName,
  formatHeartRate,
  formatKmh,
  formatKmhBare,
  formatPace,
  formatPaceClock,
  formatPer100m,
  formatPercent,
  formatSetsReps,
  formatSpeed,
  formatSportSpeed,
  formatSwimPace,
  formatVolume,
  formatWeekday,
  formatLongDate,
  formatWeight,
  movingSpeed,
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

describe("formatPaceClock", () => {
  it("formats m:ss without a unit", () => {
    expect(formatPaceClock(312)).toBe("5:12");
    expect(formatPaceClock(359.6)).toBe("6:00");
    expect(formatPaceClock(605)).toBe("10:05");
  });

  it("treats zero, negative or missing as missing", () => {
    expect(formatPaceClock(0)).toBe(MISSING);
    expect(formatPaceClock(-5)).toBe(MISSING);
    for (const input of missingInputs) expect(formatPaceClock(input)).toBe(MISSING);
  });
});

describe("movingSpeed", () => {
  it("keeps a moving speed and drops standing still", () => {
    expect(movingSpeed(3.2)).toBe(3.2);
    expect(movingSpeed(0.51)).toBe(0.51);
    expect(movingSpeed(0.5)).toBeNull();
    expect(movingSpeed(0)).toBeNull();
    for (const input of missingInputs) expect(movingSpeed(input)).toBeNull();
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

  it("takes the number of decimals", () => {
    expect(formatSpeed(7.9, 0)).toBe("28 km/h");
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

  it("formatLongDate spells the day out", () => {
    expect(formatLongDate("2026-11-09")).toBe("Monday, November 9");
    expect(formatLongDate(null)).toBe("–");
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

describe("formatInteger", () => {
  it("rounds and groups", () => {
    expect(formatInteger(139.4)).toBe("139");
    expect(formatInteger(1145)).toBe("1,145");
    expect(formatInteger(null)).toBe("–");
  });
});

describe("formatDecimal and formatSigned", () => {
  it("fixes decimals", () => {
    expect(formatDecimal(86.14)).toBe("86.1");
    expect(formatDecimal(null)).toBe("–");
  });

  it("signs with a true minus, and no sign at zero", () => {
    expect(formatSigned(3.24)).toBe("+3.2");
    expect(formatSigned(-4.9)).toBe("−4.9");
    expect(formatSigned(-0.04)).toBe("0.0");
  });
});

describe("formatSignedPercent", () => {
  it("keeps the sign, because the direction is the point", () => {
    expect(formatSignedPercent(12.46)).toBe("+12.5%");
    expect(formatSignedPercent(-3.14)).toBe("\u22123.1%");
    expect(formatSignedPercent(0)).toBe("0.0%");
  });

  it("takes the digits asked for", () => {
    expect(formatSignedPercent(12.46, 0)).toBe("+12%");
  });

  it("is a dash when there is no value", () => {
    expect(formatSignedPercent(null)).toBe(MISSING);
  });
});

describe("formatEfficiencyFactor", () => {
  it("carries its unit at two decimals", () => {
    expect(formatEfficiencyFactor(0.892)).toBe("0.89 m/min/bpm");
    expect(formatEfficiencyFactor(1)).toBe("1.00 m/min/bpm");
  });

  it("is a dash when there is no value", () => {
    expect(formatEfficiencyFactor(undefined)).toBe(MISSING);
  });
});

describe("formatVo2max", () => {
  it("carries its unit at one decimal", () => {
    expect(formatVo2max(46)).toBe("46.0 ml/kg/min");
  });

  it("is a dash when there is no value", () => {
    expect(formatVo2max(null)).toBe(MISSING);
  });
});

describe("formatRelative", () => {
  it("reads a ratio as how far it is from its baseline", () => {
    expect(formatRelative(1.12)).toBe("+12%");
    expect(formatRelative(0.92)).toBe("\u22128%");
    expect(formatRelative(1)).toBe("0%");
  });

  it("is a dash when there is no ratio", () => {
    expect(formatRelative(null)).toBe(MISSING);
  });
});

describe("formatRoughDuration", () => {
  it("steps from minutes to hours to days", () => {
    expect(formatRoughDuration(480)).toBe("8 min");
    expect(formatRoughDuration(4932)).toBe("1.4 h");
    expect(formatRoughDuration(12330)).toBe("3.4 h");
    expect(formatRoughDuration(180_000)).toBe("2.1 days");
  });

  it("keeps a stopwatch's precision out of an estimate", () => {
    // formatDuration would say "1:22:12", which this number cannot support.
    expect(formatRoughDuration(4932)).not.toContain(":");
  });

  it("is MISSING for a missing number", () => {
    expect(formatRoughDuration(null)).toBe(MISSING);
  });
});

describe("formatDays", () => {
  it("pluralises", () => {
    expect(formatDays(1)).toBe("1 day");
    expect(formatDays(115)).toBe("115 days");
  });
});

describe("formatAgo", () => {
  // `now` is built from local components, like a browser clock; the ISO strings are the
  // server's wall clock with no offset.
  const now = new Date(2026, 8, 24, 12, 0, 0);

  it("counts minutes, hours and days", () => {
    expect(formatAgo("2026-09-24T11:59:40", now)).toBe("just now");
    expect(formatAgo("2026-09-24T11:48:00", now)).toBe("12 min ago");
    expect(formatAgo("2026-09-24T09:00:00", now)).toBe("3 h ago");
    expect(formatAgo("2026-09-22T12:00:00", now)).toBe("2 d ago");
    expect(formatAgo(null, now)).toBe("–");
  });
});

describe("formatIn", () => {
  const now = new Date(2026, 8, 24, 12, 0, 0);

  it("counts forward, and says now once it is due", () => {
    expect(formatIn("2026-09-24T12:11:30", now)).toBe("in 12 min");
    expect(formatIn("2026-09-24T15:50:00", now)).toBe("in 4 h");
    expect(formatIn("2026-09-26T12:00:00", now)).toBe("in 2 d");
    expect(formatIn("2026-09-24T11:00:00", now)).toBe("now");
    expect(formatIn(null, now)).toBe("–");
  });
});

describe("formatSetsReps", () => {
  it("joins sets and reps with a middle dot", () => {
    expect(formatSetsReps(14, 135)).toBe("14 sets · 135 reps");
    expect(formatSetsReps(1, 1)).toBe("1 set · 1 rep");
    expect(formatSetsReps(12, 1145)).toBe("12 sets · 1,145 reps");
  });

  it("leaves out a missing count, and shows the placeholder when both are missing", () => {
    expect(formatSetsReps(5, null)).toBe("5 sets");
    expect(formatSetsReps(null, 40)).toBe("40 reps");
    expect(formatSetsReps(null, undefined)).toBe("–");
  });
});

describe("formatCountRange", () => {
  it("shows the first and last row shown, and the total", () => {
    expect(formatCountRange(1, 50, 488)).toBe("1–50 of 488");
    expect(formatCountRange(451, 488, 1488)).toBe("451–488 of 1,488");
  });

  it("renders missing input as the placeholder", () => {
    expect(formatCountRange(1, null, 10)).toBe("–");
  });
});

describe("formatExerciseName", () => {
  it("reads Garmin's constant as a sentence", () => {
    expect(formatExerciseName("BARBELL_DEADLIFT")).toBe("Barbell deadlift");
    expect(formatExerciseName("SQUAT")).toBe("Squat");
  });

  it("prefers the subcategory, which is the specific exercise", () => {
    expect(formatExerciseName("DEADLIFT", "ROMANIAN_DEADLIFT")).toBe("Romanian deadlift");
    expect(formatExerciseName("DEADLIFT", null)).toBe("Deadlift");
  });

  it("calls an exercise Garmin could not name unlabelled", () => {
    expect(formatExerciseName("UNKNOWN", null)).toBe("Unlabelled");
    expect(formatExerciseName(null, null)).toBe("Unlabelled");
    expect(formatExerciseName("", "")).toBe("Unlabelled");
  });
});

describe("formatWeight and formatVolume", () => {
  it("turns Garmin's grams into kilos", () => {
    expect(formatWeight(22500)).toBe("22.5 kg");
    expect(formatWeight(0)).toBe("0.0 kg");
    // Whole kilos once a plate load gets heavy enough that a tenth is noise.
    expect(formatWeight(140000)).toBe("140 kg");
    expect(formatWeight(null)).toBe("–");
  });

  it("shows volume in whole kilos", () => {
    expect(formatVolume(4850000)).toBe("4,850 kg");
    expect(formatVolume(1500)).toBe("2 kg");
    expect(formatVolume(undefined)).toBe("–");
  });
});

describe("formatKmh and formatPer100m", () => {
  it("shows a speed already in km/h, and the same without its unit for a tick", () => {
    expect(formatKmh(19.34)).toBe("19.3 km/h");
    expect(formatKmhBare(19.34)).toBe("19.3");
    expect(formatKmh(null)).toBe("–");
  });

  it("shows seconds per 100 m the way a pool does", () => {
    expect(formatPer100m(102)).toBe("1:42 /100m");
    expect(formatPer100m(0)).toBe("–");
    expect(formatPer100m(undefined)).toBe("–");
  });

  it("agrees with the metres-per-second versions", () => {
    expect(formatSpeed(5)).toBe(formatKmh(18));
    expect(formatSwimPace(1)).toBe(formatPer100m(100));
  });
});
