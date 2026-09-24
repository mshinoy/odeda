// Which muscles an exercise trains, and how much of a session's work each one took.
//
// Garmin records an exercise as a `category` and sometimes a `subCategory`
// (`DEADLIFT` / `ROMANIAN_DEADLIFT`). It sends no muscle data at all, so the mapping
// below is ours. It covers every category the owner's history contains; a subcategory
// appears only where it changes the answer, which is more often than it looks —
// Garmin files leg extensions under `CRUNCH` and a pullover under `PULL_UP`.
//
// The regions are the ones a body diagram can actually show. Anything finer (the three
// heads of the triceps, adductors) would be a claim the data cannot support.
import type { Exercise } from "@/api/adapters";
import { UNKNOWN_EXERCISE } from "@/api/adapters";

export type Muscle =
  | "chest"
  | "frontDelts"
  | "sideDelts"
  | "rearDelts"
  | "biceps"
  | "triceps"
  | "forearms"
  | "abs"
  | "obliques"
  | "lats"
  | "traps"
  | "lowerBack"
  | "glutes"
  | "quads"
  | "hamstrings"
  | "calves";

export const MUSCLE_LABELS: Readonly<Record<Muscle, string>> = {
  chest: "Chest",
  frontDelts: "Front delts",
  sideDelts: "Side delts",
  rearDelts: "Rear delts",
  biceps: "Biceps",
  triceps: "Triceps",
  forearms: "Forearms",
  abs: "Abs",
  obliques: "Obliques",
  lats: "Lats",
  traps: "Traps",
  lowerBack: "Lower back",
  glutes: "Glutes",
  quads: "Quads",
  hamstrings: "Hamstrings",
  calves: "Calves",
};

/** The muscles one exercise trains: the ones doing the work, and the ones helping. */
export interface MuscleGroups {
  primary: readonly Muscle[];
  secondary: readonly Muscle[];
}

const NOTHING: MuscleGroups = { primary: [], secondary: [] };

function groups(primary: Muscle[], secondary: Muscle[] = []): MuscleGroups {
  return { primary, secondary };
}

/**
 * Category to muscles. Two entries are deliberately empty: `BANDED_EXERCISES` and
 * `SUSPENSION` name a piece of equipment, not a movement, so only their subcategories
 * say anything.
 */
const BY_CATEGORY: Readonly<Record<string, MuscleGroups>> = {
  BANDED_EXERCISES: NOTHING,
  BENCH_PRESS: groups(["chest"], ["frontDelts", "triceps"]),
  CALF_RAISE: groups(["calves"]),
  CARRY: groups(["forearms", "traps"], ["abs", "obliques"]),
  CRUNCH: groups(["abs"], ["obliques"]),
  CURL: groups(["biceps"], ["forearms"]),
  DEADLIFT: groups(["lowerBack", "glutes", "hamstrings"], ["traps", "lats", "forearms", "quads"]),
  FLYE: groups(["chest"], ["frontDelts"]),
  HIP_STABILITY: groups(["glutes"], ["quads"]),
  HYPEREXTENSION: groups(["lowerBack"], ["glutes", "hamstrings"]),
  LATERAL_RAISE: groups(["sideDelts"], ["traps"]),
  LEG_CURL: groups(["hamstrings"], ["calves"]),
  LEG_RAISE: groups(["abs"], ["obliques"]),
  LUNGE: groups(["quads", "glutes"], ["hamstrings", "calves"]),
  PULL_UP: groups(["lats"], ["biceps", "rearDelts", "forearms"]),
  PUSH_UP: groups(["chest"], ["triceps", "frontDelts", "abs"]),
  ROW: groups(["lats", "traps"], ["biceps", "rearDelts"]),
  SHOULDER_PRESS: groups(["frontDelts"], ["sideDelts", "triceps", "traps"]),
  SIT_UP: groups(["abs"], ["obliques"]),
  SQUAT: groups(["quads", "glutes"], ["hamstrings", "lowerBack"]),
  SUSPENSION: NOTHING,
  TRICEPS_EXTENSION: groups(["triceps"]),
  [UNKNOWN_EXERCISE]: NOTHING,
};

/**
 * Subcategory to muscles, where it is not simply its category. Everything else falls
 * back to the category, so a new variant of a known lift needs no entry here.
 */
const BY_SUB_CATEGORY: Readonly<Record<string, MuscleGroups>> = {
  // Banded and suspension work: the movement is in the subcategory alone.
  LEG_ADDUCTION: groups(["glutes"], ["quads"]),
  CHEST_FLY: groups(["chest"], ["frontDelts"]),

  // An incline press moves the work up onto the front delts.
  INCLINE_DUMBBELL_BENCH_PRESS: groups(["chest", "frontDelts"], ["triceps"]),
  NEUTRAL_GRIP_DUMBBELL_INCLINE_BENCH_PRESS: groups(["chest", "frontDelts"], ["triceps"]),

  // Garmin files leg extensions under CRUNCH; they are a quad exercise.
  LEG_EXTENSIONS: groups(["quads"]),
  WEIGHTED_LEG_EXTENSIONS: groups(["quads"]),

  // A curl that finishes overhead is half a shoulder press.
  HAMMER_CURL_TO_PRESS: groups(["biceps", "frontDelts"], ["forearms", "triceps"]),

  // A Romanian deadlift is a hinge off the hamstrings, not a floor pull.
  ROMANIAN_DEADLIFT: groups(["hamstrings", "glutes"], ["lowerBack"]),

  // A pullover is a lat and chest exercise, and a chin-up pulls hard with the biceps.
  EZ_BAR_PULLOVER: groups(["lats", "chest"], ["triceps"]),
  LYING_DUMBBELL_PULLOVER_TO_EXTENSION: groups(["triceps", "lats"], ["chest"]),
  CHIN_UP: groups(["lats", "biceps"], ["forearms"]),
  LAT_PULLDOWN: groups(["lats"], ["biceps", "rearDelts"]),

  // A machine press takes the lower back out of a squat; a step-up puts calves in.
  LEG_PRESS: groups(["quads", "glutes"], ["hamstrings"]),
  DUMBBELL_STEP_UP: groups(["quads", "glutes"], ["hamstrings", "calves"]),
  ALTERNATING_BOX_DUMBBELL_STEP_UPS: groups(["quads", "glutes"], ["hamstrings", "calves"]),
};

/**
 * The categories a relabel can choose from (T16b): the ones that say which muscles an
 * exercise trains. `UNKNOWN` is not offered — reverting the relabel is how you go back
 * to "Garmin did not know" — and neither are the equipment-only categories, which
 * would teach the diagram nothing.
 */
export const RELABEL_CATEGORIES: readonly string[] = Object.entries(BY_CATEGORY)
  .filter(([, groups]) => groups.primary.length > 0)
  .map(([category]) => category)
  .sort();

/** The muscles an exercise trains. Empty for an exercise Garmin could not name. */
export function musclesFor(
  category: string | null,
  subCategory: string | null = null,
): MuscleGroups {
  if (subCategory) {
    const bySub = BY_SUB_CATEGORY[subCategory];
    if (bySub) return bySub;
  }
  return (category && BY_CATEGORY[category]) || NOTHING;
}

/** Every muscle an exercise touches, the ones doing the work first. */
export function musclesOf(category: string | null, subCategory: string | null = null): Muscle[] {
  const { primary, secondary } = musclesFor(category, subCategory);
  return [...primary, ...secondary];
}

/** How much work each muscle took. Muscles the session never touched are absent. */
export type MuscleLoad = Partial<Record<Muscle, number>>;

/** A helping muscle counts for half of a set, a working one for all of it. */
const SECONDARY_WEIGHT = 0.5;

/**
 * A session's work per muscle: sets on the muscles doing the work, half sets on the
 * ones helping. Sets, not reps or weight — reps and weight are not comparable between
 * a set of curls and a set of squats, and sets are what Garmin counts reliably.
 */
export function muscleLoad(exercises: readonly Exercise[]): MuscleLoad {
  const load: MuscleLoad = {};
  const add = (muscle: Muscle, amount: number) => {
    load[muscle] = (load[muscle] ?? 0) + amount;
  };
  for (const exercise of exercises) {
    const sets = exercise.sets ?? 0;
    if (sets <= 0) continue;
    const { primary, secondary } = musclesFor(exercise.category, exercise.subCategory);
    for (const muscle of primary) add(muscle, sets);
    for (const muscle of secondary) add(muscle, sets * SECONDARY_WEIGHT);
  }
  return load;
}

/** The busiest muscle's load, which the diagram's shading is relative to; 0 when empty. */
export function maxMuscleLoad(load: MuscleLoad): number {
  return Math.max(0, ...Object.values(load));
}
