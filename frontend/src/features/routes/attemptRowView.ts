// One attempt's row, already formatted, plus how it compares with the route's best.
// Pure, so the table holds no logic and the comparison is tested without rendering.
import type { RouteAttempt, RouteStats } from "@/api/adapters";
import type { ActivityKind } from "@/lib/activityKind";
import {
  formatDate,
  formatDistance,
  formatDuration,
  formatHeartRate,
  formatInteger,
  formatSportSpeed,
  MISSING,
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
  /** Round a loop: laps timed, and the fastest of them. "" on any other route. */
  laps: string;
  bestLap: string;
  /**
   * How much slower than the route's best this attempt was, e.g. "+1:12"; "" for the
   * best. Round a loop the comparison is lap against lap: the attempt's fastest lap
   * against the fastest ever.
   */
  behind: string;
  /** The fastest counted attempt, or round a loop the one with the fastest lap. */
  best: boolean;
  /** Excluded from the route's stats by the user; the row is dimmed and says so. */
  excluded: boolean;
}

interface AttemptContext {
  kind: ActivityKind;
  /** Round a loop, attempts are compared by their laps. */
  loop: boolean;
  stats: RouteStats;
  bestActivityId: string | null;
  today?: Date;
}

export function toAttemptRowView(
  attempt: RouteAttempt,
  { kind, loop, stats, bestActivityId, today = new Date() }: AttemptContext,
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
    laps: loop ? (attempt.laps ? formatInteger(attempt.laps) : MISSING) : "",
    bestLap: loop ? formatDuration(attempt.bestLapS) : "",
    behind: loop
      ? gap(attempt, attempt.bestLapS, stats.bestLapS)
      : gap(attempt, attempt.movingTimeS, stats.bestTimeS),
    best: attempt.activityId === (loop ? stats.bestLapActivityId : bestActivityId),
    excluded: attempt.excluded,
  };
}

/**
 * Empty for the best attempt and for anything the stats leave out: a gap against a
 * best that an excluded attempt did not compete for would be meaningless.
 */
function gap(attempt: RouteAttempt, seconds: number | null, best: number | null): string {
  if (attempt.excluded || seconds === null || best === null) return "";
  const behind = seconds - best;
  return behind <= 0 ? "" : `+${formatDuration(behind)}`;
}

/** Newest first: the question on a route page is "how am I doing now". */
export function toAttemptRows(
  attempts: readonly RouteAttempt[],
  context: AttemptContext,
): AttemptRowView[] {
  return [...attempts].reverse().map((attempt) => toAttemptRowView(attempt, context));
}
