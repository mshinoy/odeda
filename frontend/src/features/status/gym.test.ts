import { describe, expect, it } from "vitest";
import { gymCards } from "@/features/status/gym";

const week = {
  week_start: "2026-09-21",
  sessions: 2,
  sets: 18,
  avg_sessions: 0.75,
  avg_sets: 6,
  sessions_delta_pct: 166.7,
  sets_delta_pct: 200,
};

describe("gymCards", () => {
  it("shows sessions and sets with their change against the four-week average", () => {
    expect(gymCards(week)).toEqual([
      { label: "Gym sessions", value: "2", delta: "▲ 167% vs 4-wk avg" },
      { label: "Gym sets", value: "18", delta: "▲ 200% vs 4-wk avg" },
    ]);
  });

  it("shows a drop, and a zero week", () => {
    const quiet = { ...week, sessions: 0, sets: 0, sessions_delta_pct: -100, sets_delta_pct: -100 };
    expect(gymCards(quiet).map((c) => [c.value, c.delta])).toEqual([
      ["0", "▼ 100% vs 4-wk avg"],
      ["0", "▼ 100% vs 4-wk avg"],
    ]);
  });

  it("leaves the delta out when the four weeks before had no gym session", () => {
    const fresh = {
      ...week,
      avg_sessions: 0,
      avg_sets: 0,
      sessions_delta_pct: null,
      sets_delta_pct: null,
    };
    expect(gymCards(fresh).every((c) => c.delta === undefined)).toBe(true);
  });
});
