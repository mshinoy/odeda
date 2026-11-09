// The gym page's answers, worked out in one testable place: how the session's volume
// compares with the session before it, how hard it was on the heart, and for each exercise
// what it was the last time.
import type { HrZoneTime } from "@/api/adapters";
import type { ExerciseHistory } from "@/api/queries/useExerciseHistory";
import { effortAnswer, type EffortAnswer, type Pill } from "@/features/activity/answers";
import type { ExerciseRow } from "@/features/activity/gym/gymSession";
import {
  formatDate,
  formatDelta,
  formatDuration,
  formatInteger,
  formatVolume,
  formatWeight,
} from "@/lib/format";

// ---------------------------------------------------------------- volume

export interface VolumeAnswer {
  label: string;
  big: string;
  /** "15 sets, 118 reps, 57:28", and the change on the session before when there is one. */
  detail: string;
  /** Up is not good or bad in itself, so the pill is only ever neutral. */
  pill: Pill | null;
}

export function volumeAnswer(
  volumeG: number | null,
  sets: number | null,
  reps: number | null,
  durationS: number | null,
  previous: ExerciseHistory["previous"] | undefined,
): VolumeAnswer {
  const counts = [
    sets === null ? null : `${formatInteger(sets)} sets`,
    reps === null ? null : `${formatInteger(reps)} reps`,
    durationS === null ? null : formatDuration(durationS),
  ].filter((part) => part !== null);

  const prior = previous?.volume_g ?? null;
  const change =
    volumeG !== null && prior !== null && prior > 0
      ? { pct: ((volumeG - prior) / prior) * 100, day: previous?.day ?? "" }
      : null;

  return {
    label: "Volume",
    big: volumeG === null ? "–" : formatVolume(volumeG),
    detail: counts.join(", ") + (counts.length > 0 ? "." : ""),
    pill: change
      ? {
          text: `${formatDelta(change.pct, 0)} on ${formatDate(change.day)}`,
          tone: "neutral",
        }
      : null,
  };
}

// ---------------------------------------------------------------- effort

/** Mostly Zones 1 and 2 on a gym floor is the norm, and says the work was not aerobic. */
export function gymEffortAnswer(
  zones: readonly HrZoneTime[],
  trimp: number | null,
  avgHr: number | null,
  maxHr: number | null,
): EffortAnswer | null {
  const base = effortAnswer(zones, trimp, avgHr, maxHr);
  if (!base) return null;
  const light = base.big === "Easy aerobic";
  return {
    ...base,
    big: light ? "Light on the heart" : base.big === "Hard" ? "Heart rate worked" : "Moderate",
    detail: light ? `${base.detail} The work was in the muscles, not the lungs.` : base.detail,
  };
}

// ---------------------------------------------------------------- each exercise

export interface ExerciseComparison {
  index: number;
  /** The heaviest set as a share of the session's heaviest, for the bar. Null with no weight. */
  barPct: number | null;
  weight: string;
  /** "▲ 11 kg", "▼ 2.5 kg", "same", "first time", "name it to compare". */
  change: string;
  tone: "up" | "down" | "same" | "none";
  /** When it was last done, for the line under the change. */
  since: string | null;
}

const SAME_WEIGHT_G = 100;

function kilos(grams: number): string {
  const kg = Math.abs(grams) / 1000;
  return `${Number.isInteger(kg) ? kg : kg.toFixed(1)} kg`;
}

/**
 * How each exercise went against the last time, by its heaviest set. Only the weight is
 * compared: reps and sets move around from one session to the next and say little. An
 * exercise Garmin could not name has no history until it is named.
 */
export function exerciseComparisons(
  rows: readonly ExerciseRow[],
  history: ExerciseHistory | undefined,
): ExerciseComparison[] {
  const heaviest = Math.max(0, ...rows.map((r) => r.maxWeightG ?? 0));
  return rows.map((row) => {
    const last = history?.exercises.find((e) => e.index === row.index)?.last ?? null;
    const base = {
      index: row.index,
      barPct:
        row.maxWeightG !== null && heaviest > 0
          ? Math.round((row.maxWeightG / heaviest) * 100)
          : null,
      weight: row.maxWeightG === null ? "–" : formatWeight(row.maxWeightG),
    };
    if (row.unlabelled) {
      return { ...base, change: "name it to compare", tone: "none" as const, since: null };
    }
    if (last === null) {
      return { ...base, change: "first time", tone: "none" as const, since: null };
    }
    const since = formatDate(last.day);
    if (row.maxWeightG === null || last.max_weight_g === null) {
      return { ...base, change: "no weight", tone: "none" as const, since };
    }
    const diff = row.maxWeightG - last.max_weight_g;
    if (Math.abs(diff) < SAME_WEIGHT_G)
      return { ...base, change: "same", tone: "same" as const, since };
    return diff > 0
      ? { ...base, change: `▲ ${kilos(diff)}`, tone: "up" as const, since }
      : { ...base, change: `▼ ${kilos(diff)}`, tone: "down" as const, since };
  });
}
