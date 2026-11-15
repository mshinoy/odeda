import { describe, expect, it } from "vitest";
import type { Plan, PlanSession, PlanWeek } from "@/api/queries/usePlan";
import type { CalendarDay } from "@/features/plan/planView";
import {
  adherenceDelta,
  calendarWeeks,
  dayVerdict,
  efficacySentence,
  isCurrentWeek,
  linkCandidates,
  sessionLabel,
  sessionLine,
  verdictSentence,
  VERDICT_DISPLAY,
  weeklyKmSeries,
} from "@/features/plan/planView";

function week(start: string, over: Partial<PlanWeek> = {}): PlanWeek {
  return {
    week: start,
    start,
    sessions_prescribed: 4,
    sessions_planned: 4,
    sessions_done: 4,
    adherence_pct: 100,
    planned_km: 25.2,
    actual_km: 25.9,
    long_run: "done",
    substitutions: 0,
    ...over,
  };
}

function session(over: Partial<PlanSession> = {}): PlanSession {
  return {
    day: "2026-10-02",
    sport: "running",
    kind: "long",
    planned_min_m: 18000,
    planned_max_m: 18000,
    title: "Long Run - DBRC",
    optional: false,
    ignored: false,
    session_ids: [7],
    verdict: "missed",
    activity_id: null,
    actual_sport: null,
    actual_m: null,
    actual_s: null,
    moved_from: null,
    ...over,
  };
}

function plan(over: Partial<Plan> = {}): Plan {
  return {
    subscribed: true,
    source: null,
    today: "2026-10-05",
    weeks: [week("2026-09-28")],
    adherence_4wk: 80,
    this_week: week("2026-09-28", { sessions_done: 3, sessions_planned: 4 }),
    next_session: null,
    decisions: [],
    targets: {
      peak_weekly_km: 25.2,
      mean_weekly_km: 20,
      source: "plan",
      ctl_target: 45,
      load_per_km: 12.5,
    },
    unreadable: [],
    unplanned: [],
    ...over,
  };
}

describe("verdict display", () => {
  it("gives every verdict a word, never a colour on its own", () => {
    for (const display of Object.values(VERDICT_DISPLAY)) {
      expect(display.label).not.toBe("");
    }
  });

  it("keeps red for a session that did not happen", () => {
    expect(VERDICT_DISPLAY.missed.tone).toBe("critical");
    // A short run happened. It is not the same failure and must not read like one.
    expect(VERDICT_DISPLAY.short.tone).toBe("warning");
  });
});

describe("sessionLabel", () => {
  it("prefers the kind, which is more specific than the sport", () => {
    expect(sessionLabel({ sport: "running", kind: "long" })).toBe("long run");
  });

  it("falls back to the sport when the plan named no kind", () => {
    expect(sessionLabel({ sport: "cycling", kind: null })).toBe("ride");
  });

  it("says something rather than nothing when it knows neither", () => {
    expect(sessionLabel({ sport: null, kind: null })).toBe("session");
  });
});

describe("sessionLine", () => {
  it("reads as the owner would say it", () => {
    expect(sessionLine(session())).toBe("Fri · long run · 18.0 km");
  });

  it("drops the distance the plan did not set", () => {
    expect(sessionLine(session({ planned_min_m: null, kind: "cross", sport: "cycling" }))).toBe(
      "Fri · cross-training",
    );
  });
});

describe("verdictSentence", () => {
  it("says the plan is not connected before anything else", () => {
    expect(verdictSentence(plan({ subscribed: false }))).toBe("No training plan is connected.");
  });

  it("counts this week and carries the four-week number", () => {
    expect(verdictSentence(plan())).toBe("3 of 4 sessions this week, and 80% over the last four.");
  });

  it("does not invent a percentage for a block with nothing judged yet", () => {
    expect(verdictSentence(plan({ adherence_4wk: null }))).toBe("3 of 4 sessions this week.");
  });

  it("handles a subscribed calendar that has prescribed nothing", () => {
    expect(verdictSentence(plan({ weeks: [], this_week: null }))).toContain("prescribed nothing");
  });
});

describe("adherenceDelta", () => {
  it("compares the last four judged weeks with the four before them", () => {
    const weeks = [
      week("2026-08-31", { adherence_pct: 50 }),
      week("2026-09-07", { adherence_pct: 50 }),
      week("2026-09-14", { adherence_pct: 50 }),
      week("2026-09-21", { adherence_pct: 50 }),
      week("2026-09-28", { adherence_pct: 75 }),
      week("2026-10-05", { adherence_pct: 75 }),
      week("2026-10-12", { adherence_pct: 75 }),
      week("2026-10-19", { adherence_pct: 75 }),
    ];
    expect(adherenceDelta(weeks)).toBe(25);
  });

  it("skips weeks with nothing to judge rather than scoring them zero", () => {
    const weeks = [week("2026-09-28", { adherence_pct: null }), week("2026-10-05")];
    expect(adherenceDelta(weeks)).toBeNull();
  });

  it("is null before there is anything to compare against", () => {
    expect(adherenceDelta([week("2026-10-05")])).toBeNull();
  });
});

describe("efficacySentence", () => {
  it("counts the long runs that held together", () => {
    const decoupling = [
      { decoupling_pct: 3, aerobically_durable: true },
      { decoupling_pct: 9, aerobically_durable: false },
      { decoupling_pct: 2, aerobically_durable: true },
    ];
    expect(efficacySentence({ decoupling, projectedSeconds: 7200 })).toBe(
      "2 of the last 3 long runs held together to the end.",
    );
  });

  it("says why it cannot judge rather than claiming the training worked", () => {
    const decoupling = [{ decoupling_pct: null, aerobically_durable: false }];
    expect(efficacySentence({ decoupling, projectedSeconds: 7200 })).toContain("heart rate");
  });

  it("stays silent on a database with nothing in it at all", () => {
    expect(efficacySentence({ decoupling: [], projectedSeconds: null })).toBeNull();
  });
});

describe("isCurrentWeek", () => {
  it("includes the Monday and excludes the next one", () => {
    expect(isCurrentWeek(week("2026-10-05"), "2026-10-05")).toBe(true);
    expect(isCurrentWeek(week("2026-10-05"), "2026-10-11")).toBe(true);
    expect(isCurrentWeek(week("2026-10-05"), "2026-10-12")).toBe(false);
  });
});

describe("linkCandidates", () => {
  const unplanned = [
    { activity_id: "a", day: "2026-10-01" },
    { activity_id: "b", day: "2026-10-02" },
    { activity_id: "c", day: "2026-10-05" },
  ];

  it("offers only what the matcher would actually accept", () => {
    // A manual link is read on the session's day and the two either side; offering
    // Monday's run for Friday's session would be a button that does nothing.
    expect(linkCandidates(session(), unplanned).map((a) => a.activity_id)).toEqual(["a", "b"]);
  });

  it("does not offer the activity already matched to the session", () => {
    const matched = session({ activity_id: "b" });
    expect(linkCandidates(matched, unplanned).map((a) => a.activity_id)).toEqual(["a"]);
  });
});

describe("weeklyKmSeries", () => {
  const ran = [
    { start: "2026-09-28", km: 20 },
    { start: "2026-10-05", km: 24 },
  ];
  const planned = [
    week("2026-10-05", { planned_km: 25.2 }),
    week("2026-10-12", { planned_km: 28 }),
  ];

  it("carries the prescription past the last week that was run", () => {
    const series = weeklyKmSeries(ran, planned);
    expect(series.map((w) => w.start)).toEqual(["2026-09-28", "2026-10-05", "2026-10-12"]);
    expect(series.at(-1)).toEqual({ start: "2026-10-12", km: 0, plannedKm: 28 });
  });

  it("breaks the line on a week the plan never mentioned, rather than drawing a zero", () => {
    expect(weeklyKmSeries(ran, planned).at(0)?.plannedKm).toBeNull();
  });

  it("keeps only the last `count` weeks", () => {
    expect(weeklyKmSeries(ran, planned, 2).map((w) => w.start)).toEqual([
      "2026-10-05",
      "2026-10-12",
    ]);
  });
});

describe("calendarWeeks", () => {
  const weeks = [week("2026-10-05"), week("2026-10-12")];

  it("lays a week out as seven days, Monday first", () => {
    const [first] = calendarWeeks(weeks, [], "2026-10-09");
    expect(first?.days).toHaveLength(7);
    expect(first?.days.at(0)?.date).toBe("2026-10-05");
    expect(first?.days.at(-1)?.date).toBe("2026-10-11");
  });

  it("puts each session on its own day", () => {
    const [first] = calendarWeeks(
      weeks,
      [session({ day: "2026-10-09", title: "Long Run - DBRC" })],
      "2026-10-09",
    );
    expect(first?.days[4]?.date).toBe("2026-10-09");
    expect(first?.days[4]?.sessions.map((s) => s.title)).toEqual(["Long Run - DBRC"]);
    expect(first?.days[0]?.sessions).toEqual([]);
  });

  it("keeps both sessions when a day prescribes two", () => {
    // The owner's Mondays carry a run and a gym session. Showing one would be wrong.
    const [first] = calendarWeeks(
      weeks,
      [
        session({ day: "2026-10-05", title: "Easy run 5 km" }),
        session({ day: "2026-10-05", title: "Gym before swim", sport: "strength" }),
      ],
      "2026-10-09",
    );
    expect(first?.days[0]?.sessions).toHaveLength(2);
  });

  it("marks today, and the days still to come", () => {
    const [first] = calendarWeeks(weeks, [], "2026-10-07");
    expect(first?.days[2]?.isToday).toBe(true);
    expect(first?.days[2]?.isFuture).toBe(false);
    expect(first?.days[3]?.isFuture).toBe(true);
    expect(first?.days[1]?.isFuture).toBe(false);
  });

  it("marks the current week and no other", () => {
    const rows = calendarWeeks(weeks, [], "2026-10-07");
    expect(rows.map((r) => r.isCurrent)).toEqual([true, false]);
  });

  it("keeps a week that prescribed nothing, rather than dropping the row", () => {
    const rows = calendarWeeks(weeks, [], "2026-10-07");
    expect(rows).toHaveLength(2);
    expect(rows[1]?.days.every((d) => d.sessions.length === 0)).toBe(true);
  });

  it("ignores a session outside every week it was given", () => {
    const rows = calendarWeeks(weeks, [session({ day: "2021-08-10" })], "2026-10-07");
    expect(rows.flatMap((r) => r.days).every((d) => d.sessions.length === 0)).toBe(true);
  });
});

describe("dayVerdict", () => {
  const day = (verdicts: PlanSession["verdict"][]) =>
    ({
      date: "2026-11-10",
      isToday: false,
      isFuture: false,
      sessions: verdicts.map((verdict) => ({ ...session(), verdict })),
    }) as CalendarDay;

  it("shows the worst verdict, so a miss is not hidden by a done session beside it", () => {
    expect(dayVerdict(day(["done", "missed"]))).toBe("missed");
    expect(dayVerdict(day(["done", "short"]))).toBe("short");
  });

  it("is null for a day with nothing that counts", () => {
    expect(dayVerdict(day([]))).toBeNull();
  });
});
