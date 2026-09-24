import { describe, expect, it } from "vitest";
import type { Exercise } from "@/api/adapters";
import {
  MUSCLE_LABELS,
  maxMuscleLoad,
  muscleLoad,
  musclesFor,
  musclesOf,
  type Muscle,
} from "@/lib/muscles";

/**
 * Every (category, subCategory) pair in the owner's 140 sessions, as of 2026-09-24.
 * The mapping has to answer for all of them; UNKNOWN is the one that answers "nothing".
 */
const REAL_PAIRS: ReadonlyArray<readonly [string, string | null]> = [
  ["BANDED_EXERCISES", "LEG_ADDUCTION"],
  ["BENCH_PRESS", null],
  ["BENCH_PRESS", "DUMBBELL_BENCH_PRESS"],
  ["BENCH_PRESS", "INCLINE_DUMBBELL_BENCH_PRESS"],
  ["BENCH_PRESS", "NEUTRAL_GRIP_DUMBBELL_INCLINE_BENCH_PRESS"],
  ["CALF_RAISE", "SEATED_CALF_RAISE"],
  ["CALF_RAISE", "STANDING_BARBELL_CALF_RAISE"],
  ["CALF_RAISE", "STANDING_CALF_RAISE"],
  ["CARRY", "FARMERS_CARRY"],
  ["CRUNCH", "CABLE_CRUNCH"],
  ["CRUNCH", "LEG_EXTENSIONS"],
  ["CRUNCH", "WEIGHTED_CRUNCH"],
  ["CRUNCH", "WEIGHTED_LEG_EXTENSIONS"],
  ["CURL", null],
  ["CURL", "DUMBBELL_BICEPS_CURL"],
  ["CURL", "EZ_BAR_PREACHER_CURL"],
  ["CURL", "HAMMER_CURL_TO_PRESS"],
  ["DEADLIFT", "BARBELL_DEADLIFT"],
  ["DEADLIFT", "ROMANIAN_DEADLIFT"],
  ["FLYE", "CABLE_CROSSOVER"],
  ["FLYE", "DUMBBELL_FLYE"],
  ["HIP_STABILITY", "WEIGHTED_STANDING_ADDUCTION"],
  ["HYPEREXTENSION", "SPINE_EXTENSION"],
  ["HYPEREXTENSION", "WEIGHTED_STATIC_BACK_EXTENSION"],
  ["LATERAL_RAISE", null],
  ["LATERAL_RAISE", "DUMBBELL_LATERAL_RAISE"],
  ["LEG_CURL", "WEIGHTED_LEG_CURL"],
  ["LEG_RAISE", null],
  ["LUNGE", "ALTERNATING_BARBELL_FORWARD_LUNGE"],
  ["LUNGE", "ALTERNATING_DUMBBELL_LUNGE"],
  ["LUNGE", "BARBELL_BULGARIAN_SPLIT_SQUAT"],
  ["LUNGE", "DUMBBELL_BULGARIAN_SPLIT_SQUAT"],
  ["LUNGE", "WEIGHTED_WALKING_LUNGE"],
  ["PULL_UP", null],
  ["PULL_UP", "BAND_ASSISTED_PULL_UP"],
  ["PULL_UP", "CHIN_UP"],
  ["PULL_UP", "EZ_BAR_PULLOVER"],
  ["PULL_UP", "LAT_PULLDOWN"],
  ["PULL_UP", "WEIGHTED_PULL_UP"],
  ["PUSH_UP", null],
  ["ROW", null],
  ["ROW", "BARBELL_ROW"],
  ["ROW", "CHEST_SUPPORTED_DUMBBELL_ROW"],
  ["ROW", "SEATED_CABLE_ROW"],
  ["SHOULDER_PRESS", null],
  ["SHOULDER_PRESS", "DUMBBELL_SHOULDER_PRESS"],
  ["SHOULDER_PRESS", "MILITARY_PRESS"],
  ["SHOULDER_PRESS", "OVERHEAD_DUMBBELL_PRESS"],
  ["SHOULDER_PRESS", "SEATED_BARBELL_SHOULDER_PRESS"],
  ["SIT_UP", null],
  ["SQUAT", null],
  ["SQUAT", "ALTERNATING_BOX_DUMBBELL_STEP_UPS"],
  ["SQUAT", "DUMBBELL_STEP_UP"],
  ["SQUAT", "LEG_PRESS"],
  ["SQUAT", "WEIGHTED_SQUAT"],
  ["SUSPENSION", "CHEST_FLY"],
  ["TRICEPS_EXTENSION", null],
  ["TRICEPS_EXTENSION", "CABLE_KICKBACK"],
  ["TRICEPS_EXTENSION", "CABLE_OVERHEAD_TRICEPS_EXTENSION"],
  ["TRICEPS_EXTENSION", "LYING_DUMBBELL_PULLOVER_TO_EXTENSION"],
  ["TRICEPS_EXTENSION", "TRICEPS_PRESSDOWN"],
  ["UNKNOWN", null],
];

function exercise(overrides: Partial<Exercise> = {}): Exercise {
  return {
    index: 0,
    category: "BENCH_PRESS",
    subCategory: null,
    sets: 3,
    reps: 30,
    maxWeightG: 40000,
    volumeG: 1200000,
    durationMs: 300000,
    edited: false,
    garminCategory: "BENCH_PRESS",
    garminSubCategory: null,
    ...overrides,
  };
}

describe("musclesFor", () => {
  it("answers for every pair in the real data", () => {
    const unmapped = REAL_PAIRS.filter(
      ([category, sub]) => category !== "UNKNOWN" && musclesOf(category, sub).length === 0,
    );
    expect(unmapped).toEqual([]);
  });

  it("maps an unlabelled exercise to nothing", () => {
    expect(musclesFor("UNKNOWN", null)).toEqual({ primary: [], secondary: [] });
    expect(musclesFor(null, null)).toEqual({ primary: [], secondary: [] });
    // A category we have never seen is not guessed at either.
    expect(musclesFor("KITE_SURFING", null)).toEqual({ primary: [], secondary: [] });
  });

  it("names only muscles the diagram can show", () => {
    for (const [category, sub] of REAL_PAIRS) {
      for (const muscle of musclesOf(category, sub)) {
        expect(MUSCLE_LABELS[muscle], `${category}/${sub}`).toBeDefined();
      }
    }
  });

  it("falls back to the category for a variant it does not know", () => {
    expect(musclesFor("BENCH_PRESS", "DUMBBELL_BENCH_PRESS")).toEqual(
      musclesFor("BENCH_PRESS", null),
    );
  });

  it("lets a subcategory change the answer", () => {
    // A hinge, not a floor pull: the hamstrings do the work and the back only helps.
    expect(musclesFor("DEADLIFT", "ROMANIAN_DEADLIFT")).toEqual({
      primary: ["hamstrings", "glutes"],
      secondary: ["lowerBack"],
    });
    // Garmin files leg extensions under CRUNCH.
    expect(musclesFor("CRUNCH", "LEG_EXTENSIONS")).toEqual({ primary: ["quads"], secondary: [] });
    expect(musclesFor("CRUNCH", null).primary).toEqual(["abs"]);
    // And a pullover under PULL_UP.
    expect(musclesFor("PULL_UP", "EZ_BAR_PULLOVER").primary).toEqual(["lats", "chest"]);
  });

  it("maps equipment-only categories through their subcategory alone", () => {
    expect(musclesOf("SUSPENSION", null)).toEqual([]);
    expect(musclesFor("SUSPENSION", "CHEST_FLY").primary).toEqual(["chest"]);
    expect(musclesOf("BANDED_EXERCISES", null)).toEqual([]);
    expect(musclesFor("BANDED_EXERCISES", "LEG_ADDUCTION").primary).toEqual(["glutes"]);
  });

  it("puts the working muscles before the helping ones", () => {
    expect(musclesOf("BENCH_PRESS", null)).toEqual(["chest", "frontDelts", "triceps"]);
  });
});

describe("muscleLoad", () => {
  it("counts a set on the working muscles and half a set on the helpers", () => {
    // 4 sets of bench: chest 4, front delts and triceps 2 each.
    expect(muscleLoad([exercise({ sets: 4 })])).toEqual({
      chest: 4,
      frontDelts: 2,
      triceps: 2,
    });
  });

  it("adds a muscle's work up across exercises", () => {
    const load = muscleLoad([
      exercise({ category: "BENCH_PRESS", sets: 4 }), // chest 4, frontDelts 2, triceps 2
      exercise({ category: "PUSH_UP", sets: 2 }), // chest 2, triceps 1, frontDelts 1, abs 1
      exercise({ category: "TRICEPS_EXTENSION", sets: 3 }), // triceps 3
    ]);
    expect(load).toEqual({ chest: 6, frontDelts: 3, triceps: 6, abs: 1 });
    expect(maxMuscleLoad(load)).toBe(6);
  });

  it("ignores an exercise with no muscles or no sets", () => {
    expect(muscleLoad([exercise({ category: "UNKNOWN" })])).toEqual({});
    expect(muscleLoad([exercise({ sets: null })])).toEqual({});
    expect(muscleLoad([exercise({ sets: 0 })])).toEqual({});
    expect(muscleLoad([])).toEqual({});
    expect(maxMuscleLoad({})).toBe(0);
  });

  it("gives a muscle trained only as a helper a half-set load", () => {
    const load = muscleLoad([exercise({ category: "CURL", sets: 3 })]);
    expect(load).toEqual({ biceps: 3, forearms: 1.5 });
  });

  it("never names a muscle the diagram cannot draw", () => {
    const load = muscleLoad(
      REAL_PAIRS.map(([c, s], i) => exercise({ index: i, category: c, subCategory: s })),
    );
    for (const muscle of Object.keys(load) as Muscle[]) {
      expect(MUSCLE_LABELS[muscle], muscle).toBeDefined();
    }
  });
});
