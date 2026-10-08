import { describe, expect, it } from "vitest";
import type { RouteAttempt, RouteStats } from "@/api/adapters";
import { toAttemptRows, toAttemptRowView } from "@/features/routes/attemptRowView";
import { MISSING } from "@/lib/format";

const today = new Date(2026, 8, 25);

const stats: RouteStats = {
  bestTimeS: 1722.9,
  medianTimeS: 2526.6,
  worstTimeS: 3344,
  improvementS: -662.9,
  firstDay: "2024-01-18",
  lastDay: "2026-09-15",
  lapM: null,
  laps: 0,
  bestLapS: null,
  bestLapActivityId: null,
  bestLapDay: null,
  medianLapS: null,
};

function attempt(overrides: Partial<RouteAttempt> = {}): RouteAttempt {
  return {
    activityId: "a1",
    day: "2026-09-15",
    startLocal: "2026-09-15T06:10:00",
    name: "Doha Running",
    distanceM: 5047.7,
    movingTimeS: 1835.0,
    avgHr: 145,
    avgSpeedMps: 2.75,
    excluded: false,
    manual: false,
    laps: null,
    lapTimesS: [],
    bestLapS: null,
    ...overrides,
  };
}

const context = { kind: "run" as const, loop: false, stats, bestActivityId: "best", today };

describe("toAttemptRowView", () => {
  it("formats the row and links to the activity", () => {
    expect(toAttemptRowView(attempt(), context)).toEqual({
      id: "a1",
      href: "/activities/a1",
      date: "Sep 15",
      name: "Doha Running",
      distance: "5.0 km",
      time: "30:35",
      pace: "6:04 /km",
      hr: "145 bpm",
      laps: "",
      bestLap: "",
      behind: "+1:52",
      best: false,
      excluded: false,
    });
  });

  it("marks the route's best attempt and leaves its gap empty", () => {
    const row = toAttemptRowView(attempt({ activityId: "best", movingTimeS: 1722.9 }), context);
    expect([row.best, row.behind]).toEqual([true, ""]);
  });

  it("shows no gap for an attempt the stats leave out", () => {
    const row = toAttemptRowView(attempt({ excluded: true }), context);
    expect([row.excluded, row.behind]).toEqual([true, ""]);
  });

  it("shows no gap when the route has no best time to compare against", () => {
    const noBest = { ...context, stats: { ...stats, bestTimeS: null } };
    expect(toAttemptRowView(attempt(), noBest).behind).toBe("");
  });

  it("names an untitled activity rather than leaving the cell empty", () => {
    expect(toAttemptRowView(attempt({ name: null }), context).name).toBe("Untitled");
  });
});

describe("round a loop", () => {
  const loopStats = { ...stats, lapM: 1641, laps: 9, bestLapS: 665, bestLapActivityId: "fast" };
  const loopContext = { ...context, loop: true, stats: loopStats };

  it("shows the laps and compares the fastest lap with the route's", () => {
    const row = toAttemptRowView(
      attempt({ laps: 3, lapTimesS: [700, 690, 712], bestLapS: 690 }),
      loopContext,
    );
    expect([row.laps, row.bestLap, row.behind, row.best]).toEqual(["3", "11:30", "+0:25", false]);
  });

  it("marks the attempt with the fastest lap, not the shortest session", () => {
    const row = toAttemptRowView(attempt({ activityId: "fast", laps: 1, bestLapS: 665 }), {
      ...loopContext,
      bestActivityId: "a1",
    });
    expect([row.best, row.behind]).toEqual([true, ""]);
  });

  it("says when an attempt had no full lap", () => {
    const row = toAttemptRowView(attempt({ laps: 0 }), loopContext);
    expect([row.laps, row.bestLap, row.behind]).toEqual([MISSING, MISSING, ""]);
  });
});

describe("toAttemptRows", () => {
  it("reverses the API's oldest-first order, without mutating it", () => {
    const attempts = [
      attempt({ activityId: "old", day: "2024-01-18" }),
      attempt({ activityId: "new", day: "2026-09-15" }),
    ];
    expect(toAttemptRows(attempts, context).map((r) => r.id)).toEqual(["new", "old"]);
    expect(attempts.map((a) => a.activityId)).toEqual(["old", "new"]);
  });
});
