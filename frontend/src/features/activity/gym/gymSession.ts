// The gym session view as pure functions: the table's rows, the session's totals, and
// what a hover highlights. The diagram and the table share one hover, so pointing at a
// row lights up the muscles it trains and pointing at a muscle lights up the rows.
import type { ActivitySummary, Exercise, GymSession } from "@/api/adapters";
import { formatExerciseName, UNLABELLED_EXERCISE } from "@/lib/format";
import { musclesOf, type Muscle } from "@/lib/muscles";

/**
 * Whether an activity gets the gym layout. `totalSets` comes from the raw payload and
 * is set exactly when Garmin recorded exercises, so a HIIT or yoga session with sets
 * counts and a `strength_training` activity without them does not.
 */
export function isGymSession(summary: Pick<ActivitySummary, "totalSets">): boolean {
  return summary.totalSets !== null;
}

export interface ExerciseRow {
  /** Position in Garmin's payload. T16b's relabels key on it, and it keys the hover. */
  index: number;
  name: string;
  /** True when Garmin could not name it; the row invites a relabel (T16b). */
  unlabelled: boolean;
  sets: number | null;
  reps: number | null;
  maxWeightG: number | null;
  volumeG: number | null;
  /** Every muscle it trains, the ones doing the work first. Empty when unlabelled. */
  muscles: Muscle[];
}

export function exerciseRows(exercises: readonly Exercise[]): ExerciseRow[] {
  return exercises.map((exercise) => {
    const name = formatExerciseName(exercise.category, exercise.subCategory);
    return {
      index: exercise.index,
      name,
      unlabelled: name === UNLABELLED_EXERCISE,
      sets: exercise.sets,
      reps: exercise.reps,
      maxWeightG: exercise.maxWeightG,
      volumeG: exercise.volumeG,
      muscles: musclesOf(exercise.category, exercise.subCategory),
    };
  });
}

/** The session's total volume in grams, or null when no exercise reports any. */
export function totalVolumeG(exercises: readonly Exercise[]): number | null {
  const reported = exercises
    .map((exercise) => exercise.volumeG)
    .filter((volume): volume is number => volume !== null);
  if (reported.length === 0) return null;
  return reported.reduce((sum, volume) => sum + volume, 0);
}

/**
 * The sets and reps to show. Garmin's own totals are the truth where it sends them;
 * summing the exercises is the fallback, and the two can differ — `totalSets` counts
 * rest sets too.
 */
export function sessionTotals(session: GymSession): { sets: number | null; reps: number | null } {
  return {
    sets: session.totalSets ?? sumOf(session.exercises, (e) => e.sets),
    reps: session.totalReps ?? sumOf(session.exercises, (e) => e.reps),
  };
}

function sumOf(
  exercises: readonly Exercise[],
  pick: (e: Exercise) => number | null,
): number | null {
  const values = exercises.map(pick).filter((value): value is number => value !== null);
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0);
}

/** What the pointer is on: a table row, a muscle on the diagram, or nothing. */
export type GymHover = { on: "exercise"; index: number } | { on: "muscle"; muscle: Muscle } | null;

/** The muscles to mark: an exercise's own, or the one being pointed at. */
export function highlightedMuscles(rows: readonly ExerciseRow[], hover: GymHover): Set<Muscle> {
  if (hover === null) return new Set();
  if (hover.on === "muscle") return new Set([hover.muscle]);
  const row = rows.find((candidate) => candidate.index === hover.index);
  return new Set(row?.muscles ?? []);
}

/** The rows to mark: the one being pointed at, or every row training the hovered muscle. */
export function highlightedRows(rows: readonly ExerciseRow[], hover: GymHover): Set<number> {
  if (hover === null) return new Set();
  if (hover.on === "exercise") return new Set([hover.index]);
  return new Set(rows.filter((row) => row.muscles.includes(hover.muscle)).map((row) => row.index));
}
