/** A Date's local calendar day as YYYY-MM-DD. */
export function toIsoDate(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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
