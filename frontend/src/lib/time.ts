/** A Date's local calendar day as YYYY-MM-DD. */
export function toIsoDate(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * UTC midnight of a YYYY-MM-DD day: the number a chart's time axis plots.
 * UTC, not local, so the value round-trips through `msToDay` in any zone.
 */
export function dayToMs(day: string): number {
  return Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)));
}

/** Back from such a timestamp to YYYY-MM-DD, so axis labels go through `format.ts`. */
export function msToDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export interface DateRange {
  start: string;
  end: string;
}

/** The n calendar days ending on (and including) `today`, as YYYY-MM-DD. */
export function lastNDays(n: number, today: Date = new Date()): DateRange {
  // Constructing from y/m/d (not subtracting milliseconds) stays correct across DST changes.
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (n - 1));
  return { start: toIsoDate(start), end: toIsoDate(today) };
}
