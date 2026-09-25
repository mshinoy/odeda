// What the merge and split dialogs offer, and what they may do with it. Pure, so the
// rules the server enforces are visible in the UI rather than found out by a 400.
import type { RouteAttempt, RouteListItem } from "@/api/adapters";
import type { PickOption } from "@/features/routes/PickList";
import { formatDate, formatDistance, formatDuration, formatInteger } from "@/lib/format";

/**
 * The routes that can be folded into this one: every other route of the same activity
 * type. Merging a walk into a run would make a cluster whose attempts are not
 * comparable, which is what the clusterer already avoids.
 */
export function mergeOptions(
  routes: readonly RouteListItem[],
  target: { id: number; activityType: string },
): PickOption[] {
  return routes
    .filter((route) => route.id !== target.id && route.activityType === target.activityType)
    .map((route) => ({
      id: String(route.id),
      label: route.name,
      detail: `${formatInteger(route.attempts)} × ${formatDistance(route.distanceM)}`,
    }));
}

/** The attempts that can be split out, newest first, as the attempts table shows them. */
export function splitOptions(
  attempts: readonly RouteAttempt[],
  today: Date = new Date(),
): PickOption[] {
  return [...attempts].reverse().map((attempt) => ({
    id: attempt.activityId,
    label: attempt.name ?? "Untitled",
    detail: `${formatDate(attempt.day, today)} · ${formatDuration(attempt.movingTimeS)}`,
  }));
}

/**
 * Why a split cannot go ahead, or null when it can. The server refuses to empty a
 * route — a route with no attempts is a rename, not a split — so the dialog says so
 * before the request rather than after it.
 */
export function splitBlockedReason(selected: number, total: number): string | null {
  if (selected === 0) return null;
  if (selected >= total)
    return "A route cannot have every attempt split out of it. Rename it instead.";
  return null;
}

/** Ticking one thing on or off, without mutating the set that was passed in. */
export function toggle(selected: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(selected);
  if (!next.delete(id)) next.add(id);
  return next;
}

/** "Merge" with nothing ticked, "Merge 2" once something is: the count is the confirmation. */
export function pickLabel(verb: string, selected: number): string {
  return selected === 0 ? verb : `${verb} ${formatInteger(selected)}`;
}
