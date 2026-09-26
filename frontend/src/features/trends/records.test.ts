import { describe, expect, it } from "vitest";
import type { AggregateStreaks, Extreme } from "@/api/queries/useAggregate";
import { formatExtreme, toExtremeRows, toStreakCards } from "@/features/trends/records";
import {
  gearName,
  hasFilters,
  NO_FILTERS,
  parseTrendsFilters,
  serializeTrendsFilters,
  toAggregateParams,
} from "@/features/trends/trendsFilters";

const today = new Date(2026, 8, 26);

const streaks: AggregateStreaks = {
  current: 0,
  longest: 6,
  longest_end: "2023-08-18",
  active_days: 444,
  span_days: 1367,
  rest_days: 923,
  active_pct: 32.5,
  biggest_week: { week: "2026-W37", activities: 4, distance_km: 42.4, hours: 2.9 },
};

function extreme(key: Extreme["key"], raw: number, activityType = "running"): Extreme {
  return {
    key,
    label: "Label",
    raw,
    day: "2026-09-23",
    activity_id: "24473027876",
    activity_name: "Al Daayen Cycling",
    activity_type: activityType,
  };
}

describe("toStreakCards", () => {
  it("reads the four consistency numbers in days", () => {
    const byLabel = new Map(toStreakCards(streaks, today).map((c) => [c.label, c]));
    expect(byLabel.get("Current streak")?.value).toBe("0 days");
    expect(byLabel.get("Longest streak")?.value).toBe("6 days");
    expect(byLabel.get("Longest streak")?.note).toBe("to Aug 18, 2023");
    expect(byLabel.get("Active days")?.value).toBe("444 days");
    expect(byLabel.get("Active days")?.note).toBe("33% of 1,367 days");
  });

  it("reads the biggest week in distance, named by its ISO week", () => {
    const week = toStreakCards(streaks, today).find((c) => c.label === "Biggest week");
    expect(week?.value).toBe("42.4 km");
    expect(week?.note).toBe("2026-W37");
  });

  it("says nothing about a span or a week it does not have", () => {
    const empty = toStreakCards(
      {
        current: 0,
        longest: 0,
        longest_end: null,
        active_days: 0,
        span_days: 0,
        rest_days: 0,
        active_pct: null,
        biggest_week: null,
      },
      today,
    );
    expect(empty.every((card) => card.note === null)).toBe(true);
    expect(empty.find((c) => c.label === "Biggest week")?.value).toBe("–");
  });
});

describe("formatExtreme", () => {
  it("reads each key in the unit its raw number is in", () => {
    expect(formatExtreme(extreme("longest_distance", 27_696.449))).toBe("27.7 km");
    expect(formatExtreme(extreme("longest_duration", 8276))).toBe("2:17:56");
    expect(formatExtreme(extreme("most_elevation", 385.2))).toBe("385 m");
    expect(formatExtreme(extreme("highest_hr", 181))).toBe("181 bpm");
    expect(formatExtreme(extreme("biggest_trimp", 187.4))).toBe("187");
  });

  it("reads the fastest average in the unit its own sport thinks in", () => {
    // Metres per second: a run in min/km, a ride in km/h, a swim in min/100 m.
    expect(formatExtreme(extreme("fastest_average", 3.0, "running"))).toBe("5:33 /km");
    expect(formatExtreme(extreme("fastest_average", 5.36, "cycling"))).toBe("19.3 km/h");
    expect(formatExtreme(extreme("fastest_average", 1.0, "lap_swimming"))).toBe("1:40 /100m");
  });
});

describe("toExtremeRows", () => {
  it("links each record to the session that set it", () => {
    const [row] = toExtremeRows([extreme("longest_distance", 27_696.449)], today);
    expect(row?.href).toBe("/activities/24473027876");
    expect(row?.when).toBe("Sep 23");
    expect(row?.activityName).toBe("Al Daayen Cycling");
  });

  it("has something to show for a session Garmin never named", () => {
    const [row] = toExtremeRows(
      [{ ...extreme("longest_distance", 1000), activity_name: null }],
      today,
    );
    expect(row?.activityName).toBe("–");
  });
});

describe("trendsFilters", () => {
  it("round-trips through the URL and leaves the defaults out", () => {
    const filters = { type: "running", start: "2026-01-01", end: null, gearId: 3 };
    const params = serializeTrendsFilters(filters);
    expect(params.toString()).toBe("type=running&start=2026-01-01&gear=3");
    expect(parseTrendsFilters(params)).toEqual(filters);
    expect(serializeTrendsFilters(NO_FILTERS).toString()).toBe("");
  });

  it("falls back to no filter for anything it cannot read", () => {
    const params = new URLSearchParams("start=last-tuesday&gear=none&type=");
    expect(parseTrendsFilters(params)).toEqual(NO_FILTERS);
    expect(hasFilters(NO_FILTERS)).toBe(false);
  });

  it("leaves an absent filter out of the query instead of sending it null", () => {
    expect(toAggregateParams({ type: "running", start: null, end: null, gearId: null })).toEqual({
      type: "running",
    });
    expect(toAggregateParams(NO_FILTERS)).toEqual({});
  });
});

describe("gearName", () => {
  it("prefers the nickname, then brand and model, then the id", () => {
    const base = { gear_id: 3, kind: "shoe" as const, brand: null, model: null, n: 12 };
    expect(gearName({ ...base, nickname: "Blue shoes" })).toBe("Blue shoes");
    expect(gearName({ ...base, nickname: null, brand: "Asics", model: "Nimbus" })).toBe(
      "Asics Nimbus",
    );
    expect(gearName({ ...base, nickname: null })).toBe("Gear 3");
  });
});
