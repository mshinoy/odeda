// The compare table's rows, already formatted, with the colour that identifies each
// activity everywhere else on the page. Pure, so the table holds no logic.
import type { ComparedAttempt } from "@/api/adapters";
import type { ColorTokens } from "@/design/tokens";
import {
  formatDate,
  formatDistance,
  formatDuration,
  formatHeartRate,
  formatSportSpeed,
} from "@/lib/format";

export interface CompareRow {
  id: string;
  href: string;
  /** The series colour: the same one its line and its track carry. */
  color: string;
  date: string;
  name: string;
  distance: string;
  time: string;
  pace: string;
  hr: string;
}

/** One row per compared activity, in the order they were asked for. */
export function toCompareRows(
  attempts: readonly ComparedAttempt[],
  tokens: ColorTokens,
  today: Date = new Date(),
): CompareRow[] {
  return attempts.map((attempt, i) => {
    const { activity } = attempt;
    return {
      id: activity.id,
      href: `/activities/${activity.id}`,
      color: tokens.series[i % tokens.series.length] ?? tokens.inkMuted,
      date: formatDate(activity.day, today),
      name: activity.name.trim() || "Untitled",
      distance: formatDistance(activity.distanceM),
      time: formatDuration(activity.movingTimeS),
      pace: formatSportSpeed(activity.avgSpeedMps, activity.kind),
      hr: formatHeartRate(activity.avgHr),
    };
  });
}
