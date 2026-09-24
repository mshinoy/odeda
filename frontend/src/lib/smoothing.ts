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
