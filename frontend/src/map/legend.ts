// Pure helpers for the metric legend.

/**
 * A CSS gradient with hard stops, one band per ramp step, so the bar is stepped like
 * the route colours are (routeColor does not interpolate).
 */
export function steppedGradient(ramp: readonly string[]): string {
  const band = 100 / ramp.length;
  const stops = ramp.map((color, i) => `${color} ${percent(i * band)} ${percent((i + 1) * band)}`);
  return `linear-gradient(to right, ${stops.join(", ")})`;
}

// CSS lengths, not display text, so this is not a job for lib/format.
function percent(value: number): string {
  return `${Number(value.toFixed(3))}%`;
}
