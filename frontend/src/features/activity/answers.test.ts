import { describe, expect, it } from "vitest";
import type { RouteAttempt } from "@/api/adapters";
import type { ActivityPlan } from "@/api/queries/useActivityPlan";
import type { Performance } from "@/api/queries/usePerformance";
import {
  effortAnswer,
  newBests,
  ordinal,
  planAnswer,
  routeAnswer,
} from "@/features/activity/answers";

function at<T>(list: readonly T[], index: number): T {
  const value = list[index];
  if (value === undefined) throw new Error(`no item ${index}`);
  return value;
}

type Session = NonNullable<ActivityPlan["session"]>;

function session(over: Partial<Session> = {}): Session {
  return {
    day: "2026-11-06",
    sport: "running",
    kind: "long",
    planned_min_m: 15000,
    planned_max_m: 16000,
    title: "Long Run - DBRC",
    optional: false,
    ignored: false,
    session_ids: [1],
    verdict: "short",
    activity_id: "a1",
    actual_sport: "running",
    actual_m: 11241,
    actual_s: 6161,
    moved_from: null,
    edited: false,
    own: false,
    original_day: null,
    ...over,
  };
}

const next = session({
  day: "2026-11-13",
  verdict: "upcoming",
  actual_m: null,
  planned_min_m: 16000,
});

describe("planAnswer", () => {
  it("says a short long run is short, by how much, and what comes next", () => {
    const answer = planAnswer({ session: session(), next });
    expect(answer?.label).toBe("Against the plan · Long run");
    expect(answer?.pill).toEqual({ text: "Short", tone: "warning" });
    expect(answer?.big).toBe("11.2 of 15.0 km");
    expect(answer?.detail).toBe("The plan asked 15.0 km to 16.0 km. Next: Fri Nov 13, 16.0 km.");
  });

  it("marks where the plan's minimum sits on the biggest it asked", () => {
    const answer = planAnswer({ session: session(), next: null });
    expect(answer?.bar?.fraction).toBeCloseTo(11241 / 16000);
    expect(answer?.bar?.marker).toBeCloseTo(15000 / 16000);
  });

  it("has no marker when the plan asked for one distance", () => {
    const answer = planAnswer({ session: session({ planned_max_m: 15000 }), next: null });
    expect(answer?.bar?.marker).toBeNull();
    expect(answer?.detail).toBe("The plan asked 15.0 km.");
  });

  it("shows the title and no bar for a session with no distance", () => {
    const answer = planAnswer({
      session: session({
        planned_min_m: null,
        planned_max_m: null,
        kind: null,
        sport: "cycling",
        verdict: "done",
        title: "W2: Olympic Track Ride",
      }),
      next: null,
    });
    expect(answer?.big).toBe("W2: Olympic Track Ride");
    expect(answer?.bar).toBeNull();
    expect(answer?.pill.text).toBe("Done");
    expect(answer?.label).toBe("Against the plan");
  });

  it("says when the session was moved from another day", () => {
    const answer = planAnswer({ session: session({ moved_from: "2026-11-05" }), next: null });
    expect(answer?.detail).toContain("Moved from Nov 5.");
  });

  it("is nothing for an activity the plan never asked for", () => {
    expect(planAnswer({ session: null, next: null })).toBeNull();
    expect(planAnswer(undefined)).toBeNull();
  });
});

function attempt(
  id: string,
  day: string,
  seconds: number,
  over: Partial<RouteAttempt> = {},
): RouteAttempt {
  return {
    activityId: id,
    day,
    startLocal: `${day}T05:00:00`,
    name: null,
    distanceM: 11250,
    movingTimeS: seconds,
    avgHr: null,
    avgSpeedMps: null,
    excluded: false,
    manual: false,
    laps: null,
    lapTimesS: [],
    bestLapS: null,
    ...over,
  };
}

const three = [
  attempt("a", "2026-09-25", 6735),
  attempt("b", "2026-10-09", 6457),
  attempt("c", "2026-11-06", 6162),
];

describe("routeAnswer", () => {
  it("says how much faster than last time, and that it is the fastest yet", () => {
    const answer = routeAnswer(three, "c", 11241);
    expect(answer?.label).toBe("On this route · 3rd time");
    expect(answer?.pill).toEqual({ text: "Fastest of 3", tone: "good" });
    expect(answer?.big).toBe("4:55 faster");
  });

  it("marks this attempt among the last few", () => {
    const dots = routeAnswer(three, "c", 11241)?.dots ?? [];
    expect(dots.map((d) => d.time)).toEqual(["1:52:15", "1:47:37", "1:42:42"]);
    expect(dots.map((d) => d.current)).toEqual([false, false, true]);
  });

  it("says slower when it was", () => {
    const answer = routeAnswer(
      [at(three, 0), at(three, 2), attempt("d", "2026-11-20", 6400)],
      "d",
      11250,
    );
    expect(answer?.big).toBe("3:58 slower");
    expect(answer?.pill.text).toBe("2nd fastest of 3");
  });

  it("calls the first attempt the first, even when later ones are faster", () => {
    const answer = routeAnswer(three, "a", 11250);
    expect(answer?.big).toBe("First on this route");
    expect(answer?.pill.text).toBe("3rd fastest of 3");
  });

  it("compares only attempts of about the same length: laps are not a slower run", () => {
    const mixed = [...three, attempt("e", "2026-11-10", 12000, { distanceM: 22500 })];
    expect(routeAnswer(mixed, "c", 11241)?.pill.text).toBe("Fastest of 3");
  });

  it("leaves out an attempt the user excluded", () => {
    const withExcluded = [attempt("x", "2026-08-01", 5000, { excluded: true }), ...three];
    expect(routeAnswer(withExcluded, "c", 11241)?.pill.text).toBe("Fastest of 3");
  });

  it("is nothing with fewer than two to compare, or with no distance", () => {
    expect(routeAnswer([at(three, 2)], "c", 11241)).toBeNull();
    expect(routeAnswer(three, "c", null)).toBeNull();
    expect(routeAnswer(three, "zzz", 11241)).toBeNull();
  });
});

describe("ordinal", () => {
  it("reads 1st, 2nd, 3rd, 4th, and the teens as th", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101].map(ordinal)).toEqual([
      "1st",
      "2nd",
      "3rd",
      "4th",
      "11th",
      "12th",
      "13th",
      "21st",
      "22nd",
      "101st",
    ]);
  });
});

describe("effortAnswer", () => {
  const zones = [
    { zone: 1, seconds: 1721 },
    { zone: 2, seconds: 3995 },
    { zone: 3, seconds: 400 },
  ];

  it("calls mostly Zones 1 and 2 an easy aerobic run, and says where the time was", () => {
    const answer = effortAnswer(zones, 141, 138, 166);
    expect(answer?.big).toBe("Easy aerobic");
    expect(answer?.pill?.text).toBe("TRIMP 141");
    expect(answer?.detail).toBe("65% in Zone 2, 28% in Zone 1. Average 138 bpm, highest 166.");
    expect(answer?.zones.reduce((a, b) => a + b, 0)).toBeCloseTo(1);
  });

  it("calls a fifth in Zones 4 and 5 hard", () => {
    const hard = effortAnswer(
      [
        { zone: 2, seconds: 600 },
        { zone: 4, seconds: 300 },
        { zone: 5, seconds: 100 },
      ],
      null,
      null,
      null,
    );
    expect(hard?.big).toBe("Hard");
    expect(hard?.pill).toBeNull();
  });

  it("calls the middle steady", () => {
    expect(
      effortAnswer(
        [
          { zone: 2, seconds: 500 },
          { zone: 3, seconds: 500 },
        ],
        null,
        null,
        null,
      )?.big,
    ).toBe("Steady");
  });

  it("is nothing without zone time", () => {
    expect(effortAnswer([], 100, 130, 150)).toBeNull();
    expect(effortAnswer([{ zone: 1, seconds: 0 }], 100, 130, 150)).toBeNull();
  });
});

describe("newBests", () => {
  const performance = {
    personal_bests: [
      { distance_m: 5000, label: "5 k", seconds: 2755, day: "2026-07-11", activity_id: "old" },
      { distance_m: 10000, label: "10 k", seconds: 5602, day: "2026-11-06", activity_id: "c" },
    ],
  } as unknown as Performance;

  it("lists the records this activity holds", () => {
    expect(newBests(performance, "c")).toEqual(["10 k"]);
  });
  it("is empty for one that holds none, and before the records load", () => {
    expect(newBests(performance, "zzz")).toEqual([]);
    expect(newBests(undefined, "c")).toEqual([]);
  });
});
