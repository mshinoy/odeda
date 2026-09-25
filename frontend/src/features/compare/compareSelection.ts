// The rules for picking activities to compare, kept out of the components so the
// limits are stated once and tested.

/** Below two there is nothing to compare; above five the colours stop being telling. */
export const MIN_COMPARE = 2;
export const MAX_COMPARE = 5;

/** The `/compare` URL for a selection, in the order it was picked. */
export function compareHref(ids: readonly string[]): string {
  return `/compare?ids=${encodeURIComponent(ids.join(","))}`;
}

/** The ids a `/compare?ids=` query names, capped at what the view can draw. */
export function parseCompareIds(value: string | null): string[] {
  return (value ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id !== "")
    .slice(0, MAX_COMPARE);
}

/** Why the selection cannot be compared yet, or null when it can. */
export function compareBlockedReason(count: number): string | null {
  if (count < MIN_COMPARE) return `Pick ${MIN_COMPARE - count} more to compare.`;
  if (count > MAX_COMPARE) return `Compare at most ${MAX_COMPARE}; unpick ${count - MAX_COMPARE}.`;
  return null;
}

/**
 * Races of about this distance, most recent first, with `activity` always first: what
 * "compare races at this distance" opens. Within 10%, because a 10 km and a half
 * marathon are not the same race even though both are "a race".
 */
export const RACE_DISTANCE_TOLERANCE = 0.1;

interface Comparable {
  id: string;
  day: string;
  distanceM: number | null;
}

export function racesAtThisDistance<T extends Comparable>(activity: T, races: readonly T[]): T[] {
  const distance = activity.distanceM;
  if (distance === null || distance <= 0) return [];

  const others = races
    .filter((race) => race.id !== activity.id && withinTolerance(race.distanceM, distance))
    .sort((a, b) => b.day.localeCompare(a.day))
    .slice(0, MAX_COMPARE - 1);

  return others.length === 0 ? [] : [activity, ...others];
}

function withinTolerance(candidate: number | null, target: number): boolean {
  if (candidate === null) return false;
  return Math.abs(candidate - target) <= target * RACE_DISTANCE_TOLERANCE;
}
