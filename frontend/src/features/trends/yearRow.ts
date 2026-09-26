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
 * There is no pace column, although the backend offers one and the old UI had it.
 * `avg_pace_s_per_km` is total distance over total moving time across every sport in
 * that year, so a year with more gym and walking reads as a year that got slower: on
 * this data 2025 comes out at 30:30 /km against 2024's 11:57, which is a change in
 * what was logged and not in anyone's running. A pace per year is a real number only
 * once a sport has been chosen, which is the type filter's job (T10c).
 */
export function toYearTableRows(years: readonly YearRow[]): YearTableRow[] {
  return [...years].reverse().map((year) => ({
    year: year.period,
    activities: formatInteger(year.activities),
    distance: formatDistance(year.distance_m),
    distanceDelta: toDelta(year.changes["distance_km"]),
    hours: formatHours(year.moving_time_s),
    hoursDelta: toDelta(year.changes["moving_time_h"]),
    avgHr: formatHeartRate(year.avg_hr),
    elevation: formatElevation(year.elevation_gain_m),
  }));
}
