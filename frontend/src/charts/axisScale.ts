// Tick steps and axis extents chosen by the app rather than by ECharts, so every chart
// gets few ticks on round values and synced charts can share one x extent.

/** Steps that read well as m:ss (pace in seconds per km). */
export const SECONDS_STEPS: readonly number[] = [5, 10, 15, 20, 30, 60, 120, 300, 600, 900, 1800];

/** Steps that read well as h:mm:ss when the unit is minutes. */
export const MINUTES_STEPS: readonly number[] = [1, 2, 5, 10, 15, 20, 30, 60, 120, 180, 240];

const DECIMAL_MULTIPLIERS: readonly number[] = [1, 2, 5, 10];

/** 1, 2 or 5 times a power of ten: the smallest that splits `span` into at most `maxIntervals`. */
export function decimalStep(span: number, maxIntervals: number): number {
  const raw = span / maxIntervals;
  if (!(raw > 0)) return 1;

  const magnitude = 10 ** Math.floor(Math.log10(raw));
  for (const multiplier of DECIMAL_MULTIPLIERS) {
    const step = multiplier * magnitude;
    if (step >= raw) return step;
  }
  return 10 * magnitude;
}

/** The smallest candidate that splits `span` into at most `maxIntervals`; decimal past the list. */
export function stepFrom(
  candidates: readonly number[],
  span: number,
  maxIntervals: number,
): number {
  const raw = span / maxIntervals;
  const step = candidates.find((candidate) => candidate >= raw);
  return step ?? decimalStep(span, maxIntervals);
}

/**
 * The values between two quantiles (0..1) of the finite numbers, or null without any.
 * [0, 1] is the plain min and max; [0.02, 0.98] ignores the outermost 2% on each side.
 */
export function quantileRange(
  values: readonly (number | null)[],
  lowerQuantile: number,
  upperQuantile: number,
): [number, number] | null {
  const finite = values
    .filter((v): v is number => v !== null && Number.isFinite(v))
    .sort((a, b) => a - b);
  const last = finite.length - 1;
  const lo = finite[Math.round(lowerQuantile * last)];
  const hi = finite[Math.round(upperQuantile * last)];
  if (lo === undefined || hi === undefined) return null;
  return [lo, hi];
}

/** Grows [lo, hi] around its centre until it spans at least `minSpan`. */
export function withMinSpan([lo, hi]: [number, number], minSpan: number): [number, number] {
  const span = hi - lo;
  if (span >= minSpan) return [lo, hi];
  const grow = (minSpan - span) / 2;
  return [lo - grow, hi + grow];
}

/** Adds `fraction` of the span on each side. */
export function padded([lo, hi]: [number, number], fraction: number): [number, number] {
  const pad = (hi - lo) * fraction;
  return [lo - pad, hi + pad];
}

/** Rounds [lo, hi] outwards to multiples of `step`. */
export function snapToStep([lo, hi]: [number, number], step: number): [number, number] {
  return [cleanFloat(Math.floor(lo / step) * step), cleanFloat(Math.ceil(hi / step) * step)];
}

// 0.1 * 3 is 0.30000000000000004; ticks should sit on the value they label.
function cleanFloat(value: number): number {
  return Math.round(value * 1e9) / 1e9;
}
