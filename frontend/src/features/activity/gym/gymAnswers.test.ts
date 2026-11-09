import { describe, expect, it } from "vitest";
import type { ExerciseHistory } from "@/api/queries/useExerciseHistory";
import {
  exerciseComparisons,
  gymEffortAnswer,
  volumeAnswer,
} from "@/features/activity/gym/gymAnswers";
import type { ExerciseRow } from "@/features/activity/gym/gymSession";

function row(
  index: number,
  maxWeightG: number | null,
  over: Partial<ExerciseRow> = {},
): ExerciseRow {
  return {
    index,
    name: "Bench press",
    label: "BENCH_PRESS",
    unlabelled: false,
    edited: false,
    garminName: "Bench press",
    sets: 3,
    reps: 22,
    maxWeightG,
    volumeG: 1000,
    muscles: [],
    ...over,
  };
}

function history(
  entries: [number, number | null][],
  previous: ExerciseHistory["previous"] = null,
): ExerciseHistory {
  return {
    activity_id: "a",
    previous,
    exercises: entries.map(([index, kg]) => ({
      index,
      last: {
        activity_id: "old",
        day: "2026-07-06",
        sets: 3,
        reps: 20,
        max_weight_g: kg,
        volume_g: 1000,
      },
    })),
  };
}

describe("volumeAnswer", () => {
  const previous = { activity_id: "old", day: "2026-07-06", volume_g: 5_482_000, sets: 16 };

  it("says the counts and the change on the session before", () => {
    const answer = volumeAnswer(5_820_000, 15, 118, 3448, previous);
    expect(answer.big).toBe("5,820 kg");
    expect(answer.detail).toBe("15 sets, 118 reps, 57:28.");
    expect(answer.pill).toEqual({ text: "▲ 6% on Jul 6", tone: "neutral" });
  });

  it("says a drop too, and never calls either good or bad", () => {
    const answer = volumeAnswer(4_000_000, 12, 90, 3000, previous);
    expect(answer.pill?.text.startsWith("▼")).toBe(true);
    expect(answer.pill?.tone).toBe("neutral");
  });

  it("has no change for a first session or one with no volume", () => {
    expect(volumeAnswer(5_820_000, 15, 118, 3448, null).pill).toBeNull();
    expect(volumeAnswer(null, 15, 118, 3448, previous).pill).toBeNull();
    expect(volumeAnswer(null, null, null, null, null).big).toBe("–");
  });
});

describe("gymEffortAnswer", () => {
  it("calls a session spent in Zone 1 light on the heart, and says where the work was", () => {
    const answer = gymEffortAnswer(
      [
        { zone: 1, seconds: 3000 },
        { zone: 2, seconds: 400 },
      ],
      null,
      107,
      140,
    );
    expect(answer?.big).toBe("Light on the heart");
    expect(answer?.detail).toContain("The work was in the muscles, not the lungs.");
  });

  it("calls a session with a fifth in Zones 4 and 5 heart rate worked", () => {
    const answer = gymEffortAnswer(
      [
        { zone: 2, seconds: 600 },
        { zone: 4, seconds: 400 },
      ],
      null,
      150,
      180,
    );
    expect(answer?.big).toBe("Heart rate worked");
  });

  it("is nothing without zone time", () => {
    expect(gymEffortAnswer([], null, 107, 140)).toBeNull();
  });
});

describe("exerciseComparisons", () => {
  const rows = [row(0, 55000), row(1, 60000), row(2, 20000), row(3, 60000, { unlabelled: true })];

  it("compares each exercise's heaviest set with the last time", () => {
    const out = exerciseComparisons(
      rows,
      history([
        [0, 44000],
        [1, 60000],
        [2, 25000],
      ]),
    );
    expect(out.map((c) => c.change)).toEqual(["▲ 11 kg", "same", "▼ 5 kg", "name it to compare"]);
    expect(out.map((c) => c.tone)).toEqual(["up", "same", "down", "none"]);
    expect(out[0]?.since).toBe("Jul 6");
  });

  it("says a half kilo as a half kilo", () => {
    const out = exerciseComparisons([row(0, 52500)], history([[0, 50000]]));
    expect(out[0]?.change).toBe("▲ 2.5 kg");
  });

  it("scales the bars to the session's heaviest set", () => {
    const out = exerciseComparisons(rows, undefined);
    expect(out.map((c) => c.barPct)).toEqual([92, 100, 33, 100]);
  });

  it("says first time when nothing came before, and while the history loads", () => {
    const first = exerciseComparisons([row(0, 55000)], {
      activity_id: "a",
      previous: null,
      exercises: [{ index: 0, last: null }],
    });
    expect(first[0]?.change).toBe("first time");
    expect(exerciseComparisons([row(0, 55000)], undefined)[0]?.change).toBe("first time");
  });

  it("has no bar and no comparison for an exercise with no weight", () => {
    const out = exerciseComparisons(
      [row(0, null), row(1, 40000)],
      history([
        [0, 20000],
        [1, 40000],
      ]),
    );
    expect(out[0]?.barPct).toBeNull();
    expect(out[0]?.change).toBe("no weight");
    expect(out[0]?.weight).toBe("–");
  });
});
