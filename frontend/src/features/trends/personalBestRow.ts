// One row of the records table, already formatted. Pure, so the table below holds no
// logic and the formatting is tested without rendering anything.
import type { components } from "@/api/schema";
import { formatDate, formatDuration, formatPace, MISSING } from "@/lib/format";

type PersonalBest = components["schemas"]["PersonalBest"];

export interface PersonalBestRow {
  distanceM: number;
  /** "5 k", "HM": the label the backend gives the standard distance. */
  label: string;
  time: string;
  pace: string;
  when: string;
  href: string;
  /**
   * The best over the last 90 days as "44:19 · Jun 30", or MISSING when that distance
   * was not covered since. Time and day are one cell: a second "When" column beside
   * the all-time one reads as a repeat of it.
   */
  recent: string;
  recentHref: string | null;
}

export function toPersonalBestRows(
  allTime: readonly PersonalBest[],
  recent90d: readonly PersonalBest[],
  today: Date = new Date(),
): PersonalBestRow[] {
  const recentByDistance = new Map(recent90d.map((best) => [best.distance_m, best]));

  return allTime.map((best) => {
    const recent = recentByDistance.get(best.distance_m);
    return {
      distanceM: best.distance_m,
      label: best.label,
      time: formatDuration(best.seconds),
      pace: formatPace(best.seconds / (best.distance_m / 1000)),
      when: formatDate(best.day, today),
      href: `/activities/${best.activity_id}`,
      recent:
        recent === undefined
          ? MISSING
          : `${formatDuration(recent.seconds)} · ${formatDate(recent.day, today)}`,
      recentHref: recent === undefined ? null : `/activities/${recent.activity_id}`,
    };
  });
}
