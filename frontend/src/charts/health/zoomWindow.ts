// Selecting and zooming a stretch of a Health chart, as pure functions over day strings.
//
// A zoom is a window of calendar days, not a range of indices: the drawn points may be
// weekly means, and a window that survives a change of resolution is the only one that
// means the same thing before and after. Zooming slices the raw data to the window and
// lets the chart resolve and rescale it, so a few weeks of a four-year range come back
// as daily points on their own y-axis.
import type { Resolution } from "@/charts/health/resolution";

export interface DayWindow {
  /** First day, inclusive, `YYYY-MM-DD`. */
  from: string;
  /** Last day, inclusive. */
  to: string;
}

const DAYS_PER_WEEK = 7;
const MS_PER_DAY = 86_400_000;

export function addDays(day: string, count: number): string {
  const date = new Date(Date.parse(day) + count * MS_PER_DAY);
  return date.toISOString().slice(0, 10);
}

/** The last day a drawn point stands for: its own day, or six after a week's first. */
function pointEnd(day: string, resolution: Resolution): string {
  return resolution === "week" ? addDays(day, DAYS_PER_WEEK - 1) : day;
}

/** The window covering drawn points `first` through `last`, whichever order they came in. */
export function windowFromIndices(
  days: readonly string[],
  first: number,
  last: number,
  resolution: Resolution,
): DayWindow | null {
  const lo = Math.max(Math.min(first, last), 0);
  const hi = Math.min(Math.max(first, last), days.length - 1);
  const from = days[lo];
  const to = days[hi];
  if (from === undefined || to === undefined) return null;
  return { from, to: pointEnd(to, resolution) };
}

/** The drawn points a window covers, as an inclusive index pair, or null when it covers none. */
export function indicesFromWindow(
  days: readonly string[],
  window: DayWindow,
  resolution: Resolution,
): [number, number] | null {
  let first = -1;
  let last = -1;
  days.forEach((day, index) => {
    if (pointEnd(day, resolution) < window.from || day > window.to) return;
    if (first === -1) first = index;
    last = index;
  });
  return first === -1 ? null : [first, last];
}

/** Half-open `[start, end)` indices of the raw days inside the window; everything for none. */
export function sliceRange(days: readonly string[], window: DayWindow | null): [number, number] {
  if (window === null) return [0, days.length];
  const start = days.findIndex((day) => day >= window.from);
  if (start === -1) return [0, 0];
  let end = start;
  while (end < days.length && (days[end] ?? "") <= window.to) end++;
  return [start, end];
}
