// Putting several activities on one x-axis, sample for sample.
//
// Two runs over the same route record different numbers of samples at different
// distances, so their points never land on the same x. ECharts' axis tooltip only
// reports series that have a point at the axis value, which meant a crosshair named
// one activity out of four. Interpolating every activity onto one grid makes "at
// 3.4 km these two were doing this" literally true, which is the whole view.

/** How many points every compared activity is plotted on. */
export const GRID_POINTS = 600;

/** `count` evenly spaced values from 0 to `max`, the x every series is plotted at. */
export function evenGrid(max: number, count: number = GRID_POINTS): number[] {
  const step = max / (count - 1);
  return Array.from({ length: count }, (_, i) => i * step);
}

/**
 * `values` read at each point of `grid`, interpolated between the samples either side.
 *
 * Null past the end of the activity (a shorter one simply stops) and wherever either
 * neighbouring sample is null, so a gap in the recording stays a gap.
 */
export function resampleOnto(
  xs: readonly number[],
  values: readonly (number | null)[],
  grid: readonly number[],
): (number | null)[] {
  if (xs.length === 0) return grid.map(() => null);

  const last = xs[xs.length - 1] ?? 0;
  let cursor = 0;

  return grid.map((x) => {
    if (x < (xs[0] ?? 0) || x > last) return null;
    // Both are ascending, so the cursor only ever moves forward across the whole grid.
    while (cursor < xs.length - 2 && (xs[cursor + 1] ?? Infinity) < x) cursor++;
    return interpolate(x, cursor, xs, values);
  });
}

function interpolate(
  x: number,
  i: number,
  xs: readonly number[],
  values: readonly (number | null)[],
): number | null {
  const x0 = xs[i];
  const x1 = xs[i + 1];
  const y0 = values[i] ?? null;
  const y1 = values[i + 1] ?? null;
  if (x0 === undefined || y0 === null) return null;
  if (x1 === undefined || y1 === null) return x === x0 ? y0 : null;
  if (x1 === x0) return y0;
  return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
}
