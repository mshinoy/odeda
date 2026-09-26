// Distance per calendar month, with the months you did nothing in put back.
//
// `/api/aggregate`'s `by_month` leaves an empty month out entirely, so plotting its
// rows straight would draw January next to April at one month's width — the same lie
// a category axis tells about irregular data. Walking every month between the first
// and the last and filling the gaps with null keeps the bars evenly spaced and leaves
// a hole where the training stopped.

import type { PeriodRow } from "@/api/queries/useAggregate";

export interface MonthPoint {
  /** `YYYY-MM`. */
  period: string;
  /** Metres that month, or null for a month with no activity at all. */
  distanceM: number | null;
}

/** Every `YYYY-MM` from `first` to `last` inclusive, in order. */
export function monthsBetween(first: string, last: string): string[] {
  const out: string[] = [];
  let year = Number(first.slice(0, 4));
  let month = Number(first.slice(5, 7));
  const lastYear = Number(last.slice(0, 4));
  const lastMonth = Number(last.slice(5, 7));

  while (year < lastYear || (year === lastYear && month <= lastMonth)) {
    out.push(`${year}-${String(month).padStart(2, "0")}`);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return out;
}

export function toMonthPoints(rows: readonly PeriodRow[]): MonthPoint[] {
  const first = rows[0]?.period;
  const last = rows[rows.length - 1]?.period;
  if (first === undefined || last === undefined) return [];

  const byPeriod = new Map(rows.map((row) => [row.period, row.distance_m]));
  return monthsBetween(first, last).map((period) => ({
    period,
    distanceM: byPeriod.get(period) ?? null,
  }));
}
