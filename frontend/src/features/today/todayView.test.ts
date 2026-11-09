import { describe, expect, it } from "vitest";
import type { PlanSession } from "@/api/queries/usePlan";
import type { DailyRow } from "@/api/queries/useHealth";
import {
  headline,
  previousWeekStart,
  sleepAverage,
  sleepBarHeights,
  sleepNights,
  weeksAround,
  weekDays,
} from "@/features/today/todayView";

function session(over: Partial<PlanSession>): PlanSession {
  return {
    day: "2026-11-02",
    sport: "running",
    kind: "easy",
    planned_min_m: 4800,
    planned_max_m: 4800,
    title: "Easy run 4.8 km",
    optional: false,
    ignored: false,
    session_ids: [1],
    verdict: "upcoming",
    activity_id: null,
    actual_sport: null,
    actual_m: null,
    actual_s: null,
    moved_from: null,
    ...over,
  };
}

describe("weekDays", () => {
  const sessions = [
    session({ day: "2026-11-02", verdict: "missed" }),
    session({
      day: "2026-11-03",
      verdict: "short",
      planned_min_m: 8000,
      actual_m: 1500,
      title: "Hills",
    }),
    session({
      day: "2026-11-04",
      verdict: "done",
      sport: "cycling",
      actual_m: 41600,
      planned_min_m: null,
      title: "Bike",
    }),
    session({ day: "2026-11-06", verdict: "upcoming", title: "Long run" }),
  ];
  const days = weekDays("2026-11-02", sessions, "2026-11-05");

  it("makes seven tiles from the Monday", () => {
    expect(days.map((d) => d.weekday)).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
    expect(days.filter((d) => d.isToday).map((d) => d.day)).toEqual(["2026-11-05"]);
  });

  it("says what became of each session, in words", () => {
    expect(days[0]?.sessions[0]?.outcome).toBe("Missed");
    expect(days[1]?.sessions[0]?.outcome).toBe("Short · 1.5 km of 8.0 km");
    expect(days[2]?.sessions[0]?.outcome).toBe("Done · 41.6 km");
    expect(days[4]?.sessions[0]?.outcome).toBe("");
  });

  it("tints by the worst thing that happened, and not at all for a day to come", () => {
    expect(days.map((d) => d.tone)).toEqual([
      "critical",
      "warning",
      "good",
      null,
      null,
      null,
      null,
    ]);
  });

  it("does not count a skipped optional session as a miss", () => {
    const optional = weekDays(
      "2026-11-02",
      [session({ verdict: "missed", optional: true })],
      "2026-11-05",
    );
    expect(optional[0]?.tone).toBeNull();
  });

  it("types a session by its sport", () => {
    expect(days[2]?.sessions[0]?.kind).toBe("ride");
  });
});

describe("previousWeekStart", () => {
  it("steps back seven days across a month end", () => {
    expect(previousWeekStart("2026-11-02")).toBe("2026-10-26");
  });
});

describe("headline", () => {
  const todo = {
    title: "Easy run 5.6 km",
    verdict: "upcoming",
    kind: "run",
    outcome: "",
    optional: false,
  } as const;
  const done = { ...todo, verdict: "done" } as const;
  const next = { weekday: "Tue", title: "Katara Hills run" };

  it("leads with the session still to do", () => {
    expect(headline([done, todo], next)).toEqual({ label: "Today", title: "Easy run 5.6 km" });
  });
  it("says so when everything asked of today is done", () => {
    expect(headline([done], next).title).toBe("Today's sessions are done");
  });
  it("calls a day with nothing a rest day and points at the next session", () => {
    expect(headline([], next)).toEqual({
      label: "Rest day · next, Tue",
      title: "Katara Hills run",
    });
    expect(headline([], null).title).toBe("Rest day");
  });
  it("ignores an optional session when deciding what is pending", () => {
    expect(headline([{ ...todo, optional: true }], null).title).toBe("Rest day");
  });
});

describe("sleep", () => {
  const rows = [
    { day: "2026-11-03", total_sleep_s: null },
    { day: "2026-11-04", total_sleep_s: 23100 },
    { day: "2026-11-05", total_sleep_s: 13800 },
    { day: "2026-11-09", total_sleep_s: 33600 },
  ] as unknown as DailyRow[];
  const nights = sleepNights(rows);

  it("keeps a night with no recording in its place", () => {
    expect(nights.map((n) => n.hours)).toEqual([
      null,
      6.416666666666667,
      3.8333333333333335,
      9.333333333333334,
    ]);
  });
  it("averages only the nights that were recorded", () => {
    expect(sleepAverage(nights)).toBeCloseTo(6.53, 2);
    expect(sleepAverage([{ day: "x", hours: null }])).toBeNull();
  });
  it("scales bars to the tallest night, leaving the unrecorded one empty", () => {
    expect(sleepBarHeights(nights)).toEqual([null, 69, 41, 100]);
  });
});

describe("weeksAround", () => {
  const weeks = Array.from({ length: 12 }, (_, i) => ({ start: `w${String(i).padStart(2, "0")}` }));

  it("takes weeks behind this one, this one, and a couple ahead", () => {
    expect(weeksAround(weeks, "w08").map((w) => w.start)).toEqual([
      "w02",
      "w03",
      "w04",
      "w05",
      "w06",
      "w07",
      "w08",
      "w09",
      "w10",
    ]);
  });
  it("stops at the start of the series", () => {
    expect(weeksAround(weeks, "w01").map((w) => w.start)).toEqual(["w00", "w01", "w02", "w03"]);
  });
  it("shows the tail when this week is past the series", () => {
    expect(weeksAround(weeks, "w99").map((w) => w.start)).toEqual([
      "w06",
      "w07",
      "w08",
      "w09",
      "w10",
      "w11",
    ]);
  });
});
