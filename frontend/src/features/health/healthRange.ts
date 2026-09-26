// The Health view's one control: how far back every chart on the page looks. It lives
// in the URL (`/health?days=365`) so Back, a reload and a shared link all agree.
//
// The window is a number of days rather than two dates because that is what
// `/api/trends`, `/api/daily` and `/api/readiness/history` all take.

export const HEALTH_RANGES = [90, 180, 365, 730] as const;

export type HealthRange = (typeof HEALTH_RANGES)[number];

/** Three months: long enough for a 28-day baseline to mean something, short enough
 * that a night is still a readable bar. */
export const DEFAULT_HEALTH_RANGE: HealthRange = 90;

export const rangeLabel: Record<HealthRange, string> = {
  90: "90 days",
  180: "6 months",
  365: "1 year",
  730: "2 years",
};

function isHealthRange(days: number): days is HealthRange {
  return HEALTH_RANGES.some((range) => range === days);
}

/** The window a URL describes; anything else falls back to the default. */
export function parseHealthRange(params: URLSearchParams): HealthRange {
  const days = Number(params.get("days"));
  return isHealthRange(days) ? days : DEFAULT_HEALTH_RANGE;
}

/** The URL for a window, with the default left out. */
export function serializeHealthRange(days: HealthRange): URLSearchParams {
  const params = new URLSearchParams();
  if (days !== DEFAULT_HEALTH_RANGE) params.set("days", String(days));
  return params;
}
