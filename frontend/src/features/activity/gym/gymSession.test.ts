import { describe, expect, it } from "vitest";
import type { Exercise, GymSession } from "@/api/adapters";
import {
  exerciseRows,
  highlightedMuscles,
  highlightedRows,
  isGymSession,
  sessionTotals,
  totalVolumeG,
} from "@/features/activity/gym/gymSession";

function exercise(overrides: Partial<Exercise> & Pick<Exercise, "index">): Exercise {
  return {
    category: "BENCH_PRESS",
    subCategory: null,
    sets: 3,
    reps: 30,
    maxWeightG: 40000,
    volumeG: 1200000,
    durationMs: 300000,
    ...overrides,
  };
}

// A session shaped like the owner's 2026-09-14 one: a few named lifts and an UNKNOWN.
const EXERCISES: Exercise[] = [
  exercise({ index: 0, category: "BENCH_PRESS", sets: 4, reps: 40, volumeG: 1600000 }),
  exercise({ index: 1, category: "DEADLIFT", subCategory: "ROMANIAN_DEADLIFT", sets: 3 }),
  exercise({ index: 2, category: "CURL", sets: 3, maxWeightG: null, volumeG: null }),
  exercise({ index: 3, category: "UNKNOWN", sets: 4, volumeG: 200000 }),
];

describe("isGymSession", () => {
  it("goes by whether Garmin recorded sets, not by the activity type", () => {
    expect(isGymSession({ totalSets: 14 })).toBe(true);
    // A HIIT session with sets counts; a strength session without them does not.
    expect(isGymSession({ totalSets: 0 })).toBe(true);
    expect(isGymSession({ totalSets: null })).toBe(false);
  });
});

describe("exerciseRows", () => {
  const rows = exerciseRows(EXERCISES);

  it("names each exercise and keeps Garmin's order and index", () => {
    expect(rows.map((row) => row.name)).toEqual([
      "Bench press",
      "Romanian deadlift",
      "Curl",
      "Unlabelled",
    ]);
    expect(rows.map((row) => row.index)).toEqual([0, 1, 2, 3]);
  });

  it("marks the row Garmin could not name, and gives it no muscles", () => {
    expect(rows.map((row) => row.unlabelled)).toEqual([false, false, false, true]);
    expect(rows[3]?.muscles).toEqual([]);
  });

  it("carries the muscles the exercise trains, working ones first", () => {
    expect(rows[0]?.muscles).toEqual(["chest", "frontDelts", "triceps"]);
    expect(rows[1]?.muscles).toEqual(["hamstrings", "glutes", "lowerBack"]);
  });
});

describe("totals", () => {
  it("adds up the volume Garmin reported", () => {
    expect(totalVolumeG(EXERCISES)).toBe(3000000);
  });

  it("has no volume when no exercise reports any", () => {
    expect(totalVolumeG([exercise({ index: 0, volumeG: null })])).toBeNull();
    expect(totalVolumeG([])).toBeNull();
  });

  it("prefers Garmin's own totals to the sum of the exercises", () => {
    const session: GymSession = {
      totalSets: 16,
      activeSets: 14,
      totalReps: 150,
      exercises: EXERCISES,
    };
    // 16, not the 14 the exercises add up to: totalSets counts rest sets too.
    expect(sessionTotals(session)).toEqual({ sets: 16, reps: 150 });
  });

  it("falls back to the sum when Garmin sent no totals", () => {
    const session: GymSession = {
      totalSets: null,
      activeSets: null,
      totalReps: null,
      exercises: EXERCISES,
    };
    expect(sessionTotals(session)).toEqual({ sets: 14, reps: 130 });
  });
});

describe("hover", () => {
  const rows = exerciseRows(EXERCISES);

  it("marks nothing when the pointer is nowhere", () => {
    expect(highlightedMuscles(rows, null).size).toBe(0);
    expect(highlightedRows(rows, null).size).toBe(0);
  });

  it("lights up an exercise's muscles when its row is hovered", () => {
    const hover = { on: "exercise", index: 1 } as const;
    expect([...highlightedMuscles(rows, hover)]).toEqual(["hamstrings", "glutes", "lowerBack"]);
    expect([...highlightedRows(rows, hover)]).toEqual([1]);
  });

  it("lights up every exercise training a muscle when the muscle is hovered", () => {
    const hover = { on: "muscle", muscle: "lowerBack" } as const;
    expect([...highlightedMuscles(rows, hover)]).toEqual(["lowerBack"]);
    // The Romanian deadlift only; the bench press and the curl leave the back alone.
    expect([...highlightedRows(rows, hover)]).toEqual([1]);
  });

  it("finds every row for a muscle several exercises share", () => {
    const hover = { on: "muscle", muscle: "forearms" } as const;
    // The curl uses them as a helper, the Romanian deadlift does not.
    expect([...highlightedRows(rows, hover)]).toEqual([2]);
  });

  it("marks nothing for an exercise row that is gone", () => {
    expect(highlightedMuscles(rows, { on: "exercise", index: 99 }).size).toBe(0);
  });
});
