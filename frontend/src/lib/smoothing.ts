// Smoothing for per-sample streams. Watches record at irregular intervals (every second,
// or "smart" every few seconds), so windows are measured in seconds, not in samples.

/**
 * The mean of the values within `windowS` seconds centred on each sample (half before,
 * half after). Nulls are gaps: they stay null and are left out of their neighbours'
 * means. `timesS` must be ascending and as long as `values`.
 */
export function rollingMean(
  values: readonly (number | null)[],
  timesS: readonly number[],
  windowS: number,
): (number | null)[] {
  const half = windowS / 2;
  const result: (number | null)[] = [];
  // The window is [start, end): both only move forward, so this is one pass.
  let start = 0;
  let end = 0;
  let sum = 0;
  let count = 0;

  for (let i = 0; i < values.length; i++) {
    const t = timesS[i] ?? 0;

    while (end < values.length && (timesS[end] ?? Infinity) <= t + half) {
      const value = values[end];
      if (value != null) {
        sum += value;
        count++;
      }
      end++;
    }
    while (start < end && (timesS[start] ?? Infinity) < t - half) {
      const value = values[start];
      if (value != null) {
        sum -= value;
        count--;
      }
      start++;
    }

    result.push(values[i] == null || count === 0 ? null : sum / count);
  }
  return result;
}

/**
 * The mean of the `window` values centred on each one, for a series whose x spacing
 * carries no meaning: one point per session, not one per second, so `rollingMean`'s
 * time window has nothing to measure. The two ends average what is there rather than
 * going null, so the line spans the data instead of starting part-way in.
 *
 * An even `window` takes one more value from the older side; that has to be decided
 * somewhere, and it keeps the window exactly `window` long.
 */
export function centredMean(values: readonly number[], window: number): number[] {
  const before = Math.floor(window / 2);
  return values.map((_, i) => {
    const lo = Math.max(i - before, 0);
    const hi = Math.min(i + (window - before), values.length);
    let sum = 0;
    for (let j = lo; j < hi; j++) sum += values[j] ?? 0;
    return sum / (hi - lo);
  });
}
