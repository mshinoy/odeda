import { describe, expect, it } from "vitest";
import type { PlanSession } from "@/api/queries/usePlan";
import type { DailyRow } from "@/api/queries/useHealth";
import {
  daySummary,
  headline,
  previousWeekStart,
  recordedNights,
  sleepAverage,
  sleepBarHeights,
  sleepNights,
  weeksAround,
  planCallLine,
  weekDays,
} from "@/features/today/todayView";
import type { DaySession, DayView } from "@/features/today/todayView";

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
    edited: false,
    own: false,
    original_day: null,
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

  it("shows what a session still to come asks for, and nothing once it has an outcome", () => {
    expect(days[4]?.sessions[0]?.target).toBe("4.8 km");
    expect(days[1]?.sessions[0]?.target).toBe("");
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
    target: "",
    optional: false,
  } as const;
  const done = { ...todo, verdict: "done" } as const;
  const next = { weekday: "Tue", title: "Hills run" };

  it("leads with the session still to do", () => {
    expect(headline([done, todo], next)).toEqual({ label: "", title: "Easy run 5.6 km" });
  });
  it("says what became of the session once it has an outcome, under its name", () => {
    expect(headline([{ ...done, outcome: "Done · 10.2 km" }], next)).toEqual({
      label: "Easy run 5.6 km",
      title: "Done · 10.2 km",
    });
    expect(
      headline([{ ...done, verdict: "short", outcome: "Short · 5.0 km of 9.7 km" }], next).title,
    ).toBe("Short · 5.0 km of 9.7 km");
    expect(headline([done], next).title).toBe("Done");
  });
  it("joins the outcomes when a day had two sessions", () => {
    const a = { ...done, outcome: "Done · 5.0 km" };
    const b = { ...done, verdict: "missed", outcome: "Missed" } as const;
    expect(headline([a, b], next).title).toBe("Done · 5.0 km · Missed");
  });
  it("calls a day with nothing a rest day and points at the next session", () => {
    expect(headline([], next)).toEqual({
      label: "Rest day · next, Tue",
      title: "Hills run",
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
  it("counts the nights that have a recording, so a gap in the data is said out loud", () => {
    expect(recordedNights(nights)).toBe(3);
    expect(nights).toHaveLength(4);
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

describe("daySummary", () => {
  const mk = (sessions: Partial<DaySession>[]) =>
    ({
      day: "2026-11-02",
      weekday: "Mon",
      date: 2,
      isToday: false,
      tone: null,
      sessions: sessions.map((s) => ({
        title: "x",
        kind: "run",
        verdict: "upcoming",
        outcome: "",
        optional: false,
        ...s,
      })),
    }) as DayView;

  it("says rest for a day with nothing and to come for one not yet happened", () => {
    expect(daySummary(mk([]))).toBe("Rest");
    expect(daySummary(mk([{}]))).toBe("To come");
  });
  it("gives a single session's outcome", () => {
    expect(daySummary(mk([{ verdict: "done", outcome: "Done · 41.6 km" }]))).toBe("Done · 41.6 km");
  });
  it("counts sessions that share a fate", () => {
    const missed = { verdict: "missed", outcome: "Missed" } as const;
    expect(daySummary(mk([missed, missed]))).toBe("Missed, 2 sessions");
  });
  it("leads a mixed day with its worst", () => {
    expect(
      daySummary(
        mk([
          { verdict: "done", outcome: "Done · 5.0 km" },
          { verdict: "missed", outcome: "Missed" },
        ]),
      ),
    ).toBe("Missed +1");
  });
});

describe("planCallLine", () => {
  const named = { kind: "named", name: "Higdon Novice 1" } as const;
  const run = (o: Parameters<typeof session>[0]) => session({ sport: "running", ...o });

  it("says what the published plan asks for today, with the kind of run", () => {
    const easy = run({ day: "2026-11-24", planned_min_m: 6400, kind: "easy", verdict: "upcoming" });
    const long = run({ day: "2026-11-27", planned_min_m: 9700, kind: "long", verdict: "upcoming" });
    expect(planCallLine(named, [easy])).toBe("Higdon Novice 1 asks for 6.4 km, easy run");
    expect(planCallLine(named, [long])).toBe("Higdon Novice 1 asks for 9.7 km, long run");
  });

  it("goes to the past tense once the session has an outcome", () => {
    const done = run({ day: "2026-11-24", planned_min_m: 6400, verdict: "done" });
    expect(planCallLine(named, [done])).toBe("Higdon Novice 1 asked for 6.4 km, easy run");
  });

  it("is silent for a calendar, a rest day, and a ride", () => {
    const r = run({ day: "2026-11-24", planned_min_m: 6400, verdict: "upcoming" });
    expect(planCallLine({ kind: "calendar", name: "Training" }, [r])).toBeNull();
    expect(planCallLine(named, [])).toBeNull();
    expect(planCallLine(named, [session({ sport: "cycling", planned_min_m: 40000 })])).toBeNull();
  });
});
