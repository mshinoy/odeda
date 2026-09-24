// What one list row shows, as strings. Kept apart from the component so the gym/distance
// choice and the fallbacks are tested and the JSX stays a plain layout.
import type { ActivitySummary } from "@/api/adapters";
import { activityTypeLabel, type ActivityKind } from "@/lib/activityKind";
import {
  formatDate,
  formatDistance,
  formatDuration,
  formatHeartRate,
  formatSetsReps,
  formatSportSpeed,
  MISSING,
} from "@/lib/format";

/** Gym sessions show one sets · reps cell where everything else shows distance and pace. */
export type RowMeasure =
  { kind: "gym"; setsReps: string } | { kind: "distance"; distance: string; pace: string };

export interface ActivityRowView {
  id: string;
  href: string;
  date: string;
  name: string;
  kind: ActivityKind;
  typeLabel: string;
  measure: RowMeasure;
  time: string;
  hr: string;
}

export function toRowView(summary: ActivitySummary, today: Date = new Date()): ActivityRowView {
  const typeLabel = activityTypeLabel(summary.type);
  return {
    id: summary.id,
    href: `/activities/${summary.id}`,
    date: formatDate(summary.day, today),
    // Garmin names nearly everything; an unnamed activity falls back to its type.
    name: summary.name.trim() || typeLabel,
    kind: summary.kind,
    typeLabel,
    measure: measureOf(summary),
    time: formatDuration(summary.movingTimeS ?? summary.durationS),
    hr: formatHeartRate(summary.avgHr),
  };
}

function measureOf(summary: ActivitySummary): RowMeasure {
  if (summary.totalSets !== null) {
    return { kind: "gym", setsReps: formatSetsReps(summary.totalSets, summary.totalReps) };
  }
  // Yoga, breathwork and the like record 0 m at 0 m/s: nothing to show, not "0 m".
  const hasDistance = summary.distanceM !== null && summary.distanceM > 0;
  if (!hasDistance) return { kind: "distance", distance: MISSING, pace: MISSING };
  return {
    kind: "distance",
    distance: formatDistance(summary.distanceM),
    pace: formatSportSpeed(summary.avgSpeedMps, summary.kind),
  };
}
