// One row of the year-over-year table, already formatted. Pure, so the table holds no
// logic and the direction of every arrow is tested without rendering anything.
import type { MetricChange, YearRow } from "@/api/queries/useAggregate";
import {
  formatDelta,
  formatDistance,
  formatElevation,
  formatHeartRate,
  formatHours,
  formatInteger,
  formatPace,
} from "@/lib/format";

/** How a change reads: the percentage, and whether it is the good direction. */
export interface Delta {
  text: string;
  tone: "good" | "bad";
}

export interface YearTableRow {
  year: string;
  activities: string;
  distance: string;
  /** Null on the first year, and on any metric the year before had none of. */
  distanceDelta: Delta | null;
  hours: string;
  hoursDelta: Delta | null;
  avgHr: string;
  elevation: string;
  /** Null unless one sport is being shown; see `toYearTableRows`. */
  pace: string | null;
  paceDelta: Delta | null;
}

/**
 * `better` comes from the backend, which is the only place that knows a smaller pace
 * is an improvement while a smaller distance is not. The percentage is shown as-is:
 * an arrow pointing down and coloured good is the honest way to draw a pace that fell.
 */
export function toDelta(change: MetricChange | null | undefined): Delta | null {
  if (change === null || change === undefined) return null;
  return { text: formatDelta(change.pct, 0), tone: change.better ? "good" : "bad" };
}

/**
 * Newest year first: the one you are in is the one you came to read.
 *
 * **Pace is only shown for one sport at a time** (`oneSport`, which the type filter
 * sets). `avg_pace_s_per_km` is total distance over total moving time across every
 * sport in the year, so unfiltered it reads 14:29 (2023), 11:57 (2024), 30:30 (2025),
 * 8:13 (2026) — a change in what was logged, not in anyone's running. Filtered to
 * running the same years read 8:56, 8:07, 8:30, 8:47, which is a pace. The column
 * appears with the filter rather than carrying a caveat, because a table cell has
 * nowhere to put one.
 */
export function toYearTableRows(
  years: readonly YearRow[],
  { oneSport = false }: { oneSport?: boolean } = {},
): YearTableRow[] {
  return [...years].reverse().map((year) => ({
    year: year.period,
    activities: formatInteger(year.activities),
    distance: formatDistance(year.distance_m),
    distanceDelta: toDelta(year.changes["distance_km"]),
    hours: formatHours(year.moving_time_s),
    hoursDelta: toDelta(year.changes["moving_time_h"]),
    avgHr: formatHeartRate(year.avg_hr),
    elevation: formatElevation(year.elevation_gain_m),
    pace: oneSport ? formatPace(year.avg_pace_s_per_km) : null,
    paceDelta: oneSport ? toDelta(year.changes["avg_pace_s_per_km"]) : null,
  }));
}
