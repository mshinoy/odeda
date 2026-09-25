// One attempt's row, already formatted, plus how it compares with the route's best.
// Pure, so the table holds no logic and the comparison is tested without rendering.
import type { RouteAttempt, RouteStats } from "@/api/adapters";
import type { ActivityKind } from "@/lib/activityKind";
import {
  formatDate,
  formatDistance,
  formatDuration,
  formatHeartRate,
  formatSportSpeed,
} from "@/lib/format";

export interface AttemptRowView {
  id: string;
  href: string;
  date: string;
  name: string;
  distance: string;
  time: string;
  pace: string;
  hr: string;
  /** How much slower than the route's best this attempt was, e.g. "+1:12"; "" for the best. */
  behind: string;
  /** The fastest counted attempt: the table marks it. */
  best: boolean;
  /** Excluded from the route's stats by the user; the row is dimmed and says so. */
  excluded: boolean;
}

interface AttemptContext {
  kind: ActivityKind;
  stats: RouteStats;
  bestActivityId: string | null;
  today?: Date;
}

export function toAttemptRowView(
  attempt: RouteAttempt,
  { kind, stats, bestActivityId, today = new Date() }: AttemptContext,
): AttemptRowView {
  return {
    id: attempt.activityId,
    href: `/activities/${attempt.activityId}`,
    date: formatDate(attempt.day, today),
    name: attempt.name ?? "Untitled",
    distance: formatDistance(attempt.distanceM),
    time: formatDuration(attempt.movingTimeS),
    pace: formatSportSpeed(attempt.avgSpeedMps, kind),
    hr: formatHeartRate(attempt.avgHr),
    behind: behindBest(attempt, stats),
    best: attempt.activityId === bestActivityId,
    excluded: attempt.excluded,
  };
}

/**
 * Empty for the best attempt and for anything the stats leave out: a gap against a
 * best that an excluded attempt did not compete for would be meaningless.
 */
function behindBest(attempt: RouteAttempt, stats: RouteStats): string {
  if (attempt.excluded || attempt.movingTimeS === null || stats.bestTimeS === null) return "";
  const gap = attempt.movingTimeS - stats.bestTimeS;
  return gap <= 0 ? "" : `+${formatDuration(gap)}`;
}

/** Newest first: the question on a route page is "how am I doing now". */
export function toAttemptRows(
  attempts: readonly RouteAttempt[],
  context: AttemptContext,
): AttemptRowView[] {
  return [...attempts].reverse().map((attempt) => toAttemptRowView(attempt, context));
}
