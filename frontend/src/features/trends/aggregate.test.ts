import { describe, expect, it } from "vitest";
import type { LifetimeTotals, PeriodRow, YearRow } from "@/api/queries/useAggregate";
import { monthsBetween, toMonthPoints } from "@/features/trends/monthlySeries";
import { toTotalCards } from "@/features/trends/totalCards";
import { toDelta, toYearTableRows } from "@/features/trends/yearRow";

const totals: LifetimeTotals = {
  activities: 488,
  distance_m: 1_396_280,
  duration_s: 1_636_764.8,
  moving_time_s: 1_472_775.9,
  elevation_gain_m: 9382.1,
  calories: 215_911,
  trimp: 21_873.9,
  avg_hr: 120.4,
  avg_distance_m: 2878.9,
  avg_moving_time_s: 3018,
  first_day: "2022-12-27",
  last_day: "2026-09-23",
  distance_km: 1396.28,
  duration_h: 454.66,
  moving_time_h: 409.1,
  avg_distance_km: 2.88,
  avg_speed_mps: 0.948,
  avg_speed_kmh: 3.41,
  avg_pace_s_per_km: 1054.8,
  span_days: 1367,
  span_years: 3.74,
  activities_per_week: 2.5,
  distance_km_per_week: 7.15,
};

const emptyTotals: LifetimeTotals = {
  ...totals,
  activities: 0,
  distance_m: 0,
  moving_time_s: 0,
  elevation_gain_m: 0,
  avg_hr: null,
  avg_distance_m: null,
  avg_distance_km: null,
  avg_speed_mps: null,
  avg_speed_kmh: null,
  avg_pace_s_per_km: null,
  first_day: null,
  last_day: null,
  span_days: 0,
  span_years: 0,
  activities_per_week: 0,
  distance_km_per_week: 0,
};

function periodRow(period: string, distanceM: number): PeriodRow {
  return { ...totals, period, distance_m: distanceM };
}

describe("toTotalCards", () => {
  it("reads every headline in its own unit", () => {
    const byLabel = new Map(toTotalCards(totals).map((card) => [card.label, card.value]));
    expect(byLabel.get("Activities")).toBe("488");
    expect(byLabel.get("Distance")).toBe("1,396 km");
    // 1,472,776 s is 409 hours, not the 409:06:15 a stopwatch would read.
    expect(byLabel.get("Moving time")).toBe("409 h");
    // Unfiltered, across every sport, a pace means nothing: it is not shown.
    expect(byLabel.get("Average pace")).toBe("–");
    expect(byLabel.get("Average HR")).toBe("120 bpm");
    expect(byLabel.get("Elevation")).toBe("9,382 m");
  });

  it("shows no pace across sports, and says to pick one", () => {
    const pace = toTotalCards(totals).find((card) => card.label === "Average pace");
    expect(pace?.value).toBe("–");
    expect(pace?.note).toBe("pick one sport");
  });

  it("shows the pace, with no caveat, once a sport has been chosen", () => {
    const pace = toTotalCards(totals, { oneSport: true }).find(
      (card) => card.label === "Average pace",
    );
    expect(pace?.value).toBe("17:35 /km");
    expect(pace?.note).toBeNull();
  });

  it("carries the rate behind a number, not a comparison it has nothing to make", () => {
    const cards = toTotalCards(totals);
    expect(cards[0]?.note).toBe("2.5 a week over 3.7 years");
    expect(cards[1]?.note).toBe("7.2 km a week");
  });

  it("drops every rate and caveat when nothing has been recorded", () => {
    expect(toTotalCards(emptyTotals).every((card) => card.note === null)).toBe(true);
  });
});

describe("toDelta", () => {
  it("takes its direction from the backend, which knows a faster pace is smaller", () => {
    // A pace 17.5% lower is an improvement; a distance 7.9% higher is too.
    // −17.5 rounds to −17: `formatDelta` rounds a tie the way Math.round does.
    expect(toDelta({ delta: -151.6, pct: -17.5, better: true })).toEqual({
      text: "▼ 17%",
      tone: "good",
    });
    expect(toDelta({ delta: 28.7, pct: 7.9, better: true })).toEqual({
      text: "▲ 8%",
      tone: "good",
    });
    expect(toDelta({ delta: -9.6, pct: -10.9, better: false })).toEqual({
      text: "▼ 11%",
      tone: "bad",
    });
  });

  it("has nothing to say about a year with no year before it", () => {
    expect(toDelta(null)).toBeNull();
    expect(toDelta(undefined)).toBeNull();
  });
});

describe("toYearTableRows", () => {
  const years: YearRow[] = [
    { ...periodRow("2024", 350_000), changes: {} },
    {
      ...periodRow("2025", 378_700),
      changes: {
        distance_km: { delta: 28.7, pct: 7.9, better: true },
        moving_time_h: { delta: -9.6, pct: -10.9, better: false },
      },
    },
  ];

  it("puts the year you are in at the top", () => {
    expect(toYearTableRows(years).map((row) => row.year)).toEqual(["2025", "2024"]);
  });

  it("formats each year in base units and leaves the first year's deltas empty", () => {
    const [latest, first] = toYearTableRows(years);
    // Past 100 km `formatDistance` drops the decimal, as it does everywhere else.
    expect(latest?.distance).toBe("379 km");
    expect(latest?.hours).toBe("409 h");
    expect(latest?.distanceDelta).toEqual({ text: "▲ 8%", tone: "good" });
    expect(latest?.hoursDelta).toEqual({ text: "▼ 11%", tone: "bad" });
    expect(first?.distanceDelta).toBeNull();
    expect(first?.hoursDelta).toBeNull();
  });

  it("leaves pace out across sports, where it measures the sport mix and not speed", () => {
    const [latest] = toYearTableRows(years);
    expect(latest?.pace).toBeNull();
    expect(latest?.paceDelta).toBeNull();
  });

  it("fills pace in once one sport is being shown", () => {
    const withPace: YearRow[] = [
      years[0] as YearRow,
      {
        ...(years[1] as YearRow),
        avg_pace_s_per_km: 510.7,
        changes: {
          ...(years[1] as YearRow).changes,
          avg_pace_s_per_km: { delta: -151.6, pct: -17.5, better: true },
        },
      },
    ];
    const [latest, first] = toYearTableRows(withPace, { oneSport: true });
    expect(latest?.pace).toBe("8:31 /km");
    expect(latest?.paceDelta).toEqual({ text: "▼ 17%", tone: "good" });
    expect(first?.paceDelta).toBeNull();
  });

  it("does not mutate the years it was given", () => {
    const order = years.map((year) => year.period);
    toYearTableRows(years);
    expect(years.map((year) => year.period)).toEqual(order);
  });
});

describe("monthsBetween", () => {
  it("walks every month, over a year end", () => {
    expect(monthsBetween("2025-11", "2026-02")).toEqual([
      "2025-11",
      "2025-12",
      "2026-01",
      "2026-02",
    ]);
  });

  it("is one month long when both ends are the same", () => {
    expect(monthsBetween("2026-09", "2026-09")).toEqual(["2026-09"]);
  });
});

describe("toMonthPoints", () => {
  it("puts back the months with no activity, as gaps rather than zeroes", () => {
    const points = toMonthPoints([periodRow("2026-01", 50_000), periodRow("2026-04", 42_400)]);
    expect(points).toEqual([
      { period: "2026-01", distanceM: 50_000 },
      { period: "2026-02", distanceM: null },
      { period: "2026-03", distanceM: null },
      { period: "2026-04", distanceM: 42_400 },
    ]);
  });

  it("has nothing to draw for an empty history", () => {
    expect(toMonthPoints([])).toEqual([]);
  });
});
