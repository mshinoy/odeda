// How many days one drawn point stands for.
//
// A chart a few hundred pixels wide cannot show four years of days: 1,350 points
// become a grey scribble whose only readable feature is the baseline drawn over it.
// Past a quarter the Health charts draw one point per week, the mean of those days, so
// the shape is legible and the day-to-day noise is averaged instead of overdrawn.
import type { DailyRow, MetricTrend, ReadinessPoint } from "@/api/queries/useHealth";
import { formatDate } from "@/lib/format";

export type Resolution = "day" | "week";

/** The longest window that is still drawn a point a day. */
export const DAILY_UP_TO_DAYS = 120;

const DAYS_PER_WEEK = 7;

export function resolutionFor(dayCount: number): Resolution {
  return dayCount > DAILY_UP_TO_DAYS ? "week" : "day";
}

/** "Sep 23", or "Week of Sep 23" when the point is a week's mean. */
export function dayHeading(day: string, resolution: Resolution, today?: Date): string {
  const date = formatDate(day, today);
  return resolution === "week" ? `Week of ${date}` : date;
}

/** Half-open index ranges, oldest first, counted back from the end so the newest week is whole. */
function chunks(length: number, resolution: Resolution): [number, number][] {
  if (resolution === "day") return Array.from({ length }, (_, i) => [i, i + 1]);
  const out: [number, number][] = [];
  for (let end = length; end > 0; end -= DAYS_PER_WEEK) {
    out.push([Math.max(end - DAYS_PER_WEEK, 0), end]);
  }
  return out.reverse();
}

function meanOf(values: readonly (number | null)[]): number | null {
  const present = values.filter((value): value is number => value !== null);
  if (present.length === 0) return null;
  return present.reduce((sum, value) => sum + value, 0) / present.length;
}

function lastOf(values: readonly (number | null)[]): number | null {
  for (let i = values.length - 1; i >= 0; i--) {
    const value = values[i];
    if (value !== null && value !== undefined) return value;
  }
  return null;
}

/** The daily values, the 28-day baseline at the close of each week. */
export function resolveTrend(trend: MetricTrend, resolution: Resolution): MetricTrend {
  if (resolution === "day") return trend;
  const ranges = chunks(trend.days.length, resolution);
  const mean = (series: readonly (number | null)[]) =>
    ranges.map(([from, to]) => meanOf(series.slice(from, to)));
  const close = (series: readonly (number | null)[]) =>
    ranges.map(([from, to]) => lastOf(series.slice(from, to)));
  return {
    ...trend,
    days: ranges.map(([from]) => trend.days[from] ?? ""),
    values: mean(trend.values),
    roll7: close(trend.roll7),
    roll28: close(trend.roll28),
    roll90: close(trend.roll90),
  };
}

/** The fields the sleep and Body Battery charts read, averaged; the rest follow the week's last day. */
export function resolveRows(rows: readonly DailyRow[], resolution: Resolution): DailyRow[] {
  if (resolution === "day") return [...rows];
  return chunks(rows.length, resolution).flatMap(([from, to]) => {
    const week = rows.slice(from, to);
    const last = week[week.length - 1];
    const first = week[0];
    if (!last || !first) return [];
    const mean = (pick: (row: DailyRow) => number | null) => meanOf(week.map(pick));
    return [
      {
        ...last,
        day: first.day,
        bb_high: mean((row) => row.bb_high),
        bb_low: mean((row) => row.bb_low),
        deep_s: mean((row) => row.deep_s),
        rem_s: mean((row) => row.rem_s),
        light_s: mean((row) => row.light_s),
        total_sleep_s: mean((row) => row.total_sleep_s),
      },
    ];
  });
}

/** A week's mean score has no single band, so the band is dropped rather than guessed. */
export function resolveReadiness(
  series: readonly ReadinessPoint[],
  resolution: Resolution,
): ReadinessPoint[] {
  if (resolution === "day") return [...series];
  return chunks(series.length, resolution).flatMap(([from, to]) => {
    const week = series.slice(from, to);
    const first = week[0];
    if (!first) return [];
    return [{ day: first.day, score: meanOf(week.map((point) => point.score)), band: null }];
  });
}
