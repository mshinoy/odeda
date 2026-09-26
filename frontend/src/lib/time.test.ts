import { describe, expect, it } from "vitest";
import { dayToMs, lastNDays, msToDay, toIsoDate } from "@/lib/time";

// Dates are built from local y/m/d so the tests hold in any timezone.
describe("toIsoDate", () => {
  it("formats the local calendar day with zero padding", () => {
    expect(toIsoDate(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(toIsoDate(new Date(2026, 11, 31, 23, 59))).toBe("2026-12-31");
  });

  it("ignores the time of day", () => {
    expect(toIsoDate(new Date(2026, 8, 23, 0, 0, 1))).toBe("2026-09-23");
  });
});

describe("dayToMs and msToDay", () => {
  it("places a day at its UTC midnight", () => {
    expect(dayToMs("1970-01-02")).toBe(86_400_000);
    expect(dayToMs("2026-09-23")).toBe(Date.UTC(2026, 8, 23));
  });

  it("round-trips every day of a leap year's February", () => {
    for (let day = 1; day <= 29; day++) {
      const iso = `2028-02-${String(day).padStart(2, "0")}`;
      expect(msToDay(dayToMs(iso))).toBe(iso);
    }
  });

  it("orders days as their timestamps", () => {
    expect(dayToMs("2023-05-11")).toBeLessThan(dayToMs("2026-09-22"));
  });
});

describe("lastNDays", () => {
  it("includes today as the last day", () => {
    expect(lastNDays(30, new Date(2026, 8, 23))).toEqual({
      start: "2026-08-25",
      end: "2026-09-23",
    });
  });

  it("returns a single day for n = 1", () => {
    expect(lastNDays(1, new Date(2026, 8, 23))).toEqual({ start: "2026-09-23", end: "2026-09-23" });
  });

  it("crosses month and year boundaries", () => {
    expect(lastNDays(7, new Date(2026, 0, 3))).toEqual({ start: "2025-12-28", end: "2026-01-03" });
  });

  it("handles leap days", () => {
    expect(lastNDays(2, new Date(2028, 2, 1))).toEqual({ start: "2028-02-29", end: "2028-03-01" });
  });

  it("stays on calendar days across a DST change", () => {
    // Late March / early November: DST transitions in Europe and the US.
    expect(lastNDays(10, new Date(2026, 2, 31, 12))).toEqual({
      start: "2026-03-22",
      end: "2026-03-31",
    });
    expect(lastNDays(10, new Date(2026, 10, 5, 0, 30))).toEqual({
      start: "2026-10-27",
      end: "2026-11-05",
    });
  });

  it("defaults to today", () => {
    const { end } = lastNDays(30);
    expect(end).toBe(toIsoDate(new Date()));
  });
});
