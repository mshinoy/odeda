// The streak cards and the extremes table, already formatted. Pure, so the components
// hold no logic and the unit each extreme is measured in is decided in one place.
import type { AggregateStreaks, Extreme } from "@/api/queries/useAggregate";
import { activityKind } from "@/lib/activityKind";
import {
  formatDate,
  formatDays,
  formatDecimal,
  formatDistance,
  formatDuration,
  formatElevation,
  formatHeartRate,
  formatPercent,
  formatSportSpeed,
  MISSING,
} from "@/lib/format";

export interface StreakCard {
  label: string;
  value: string;
  note: string | null;
}

/**
 * Four cards of consistency. "Current" is 0 unless the streak reaches today or
 * yesterday, which is the backend's rule and the only honest one: a streak that ended
 * in 2024 is not a streak you are on.
 */
export function toStreakCards(streaks: AggregateStreaks, today: Date = new Date()): StreakCard[] {
  return [
    {
      label: "Current streak",
      value: formatDays(streaks.current),
      note: null,
    },
    {
      label: "Longest streak",
      value: formatDays(streaks.longest),
      note: streaks.longest_end ? `to ${formatDate(streaks.longest_end, today)}` : null,
    },
    {
      label: "Active days",
      value: formatDays(streaks.active_days),
      note:
        streaks.active_pct === null || streaks.active_pct === undefined
          ? null
          : `${formatPercent(streaks.active_pct)} of ${formatDays(streaks.span_days)}`,
    },
    {
      label: "Biggest week",
      value: streaks.biggest_week
        ? formatDistance(streaks.biggest_week.distance_km * 1000)
        : MISSING,
      note: streaks.biggest_week?.week ?? null,
    },
  ];
}

export interface ExtremeRow {
  key: string;
  label: string;
  value: string;
  when: string;
  activityName: string;
  href: string;
}

/**
 * `raw` is a plain number and `key` says what it means — metres, seconds, metres of
 * climb, metres per second, bpm, TRIMP. The backend used to send a rendered `display`
 * beside it; the switch below replaced it, so every unit on this page comes out of
 * `format.ts`.
 */
export function formatExtreme(extreme: Extreme): string {
  switch (extreme.key) {
    case "longest_distance":
      return formatDistance(extreme.raw);
    case "longest_duration":
      return formatDuration(extreme.raw);
    case "most_elevation":
      return formatElevation(extreme.raw);
    case "fastest_average":
      // Metres per second, read in the unit its own sport thinks in.
      return formatSportSpeed(extreme.raw, activityKind(extreme.activity_type));
    case "highest_hr":
      return formatHeartRate(extreme.raw);
    case "biggest_trimp":
      return formatDecimal(extreme.raw, 0);
  }
}

export function toExtremeRows(
  extremes: readonly Extreme[],
  today: Date = new Date(),
): ExtremeRow[] {
  return extremes.map((extreme) => ({
    key: extreme.key,
    label: extreme.label,
    value: formatExtreme(extreme),
    when: formatDate(extreme.day, today),
    activityName: extreme.activity_name ?? MISSING,
    href: `/activities/${extreme.activity_id}`,
  }));
}
