// What the merge and split dialogs offer, and what they may do with it. Pure, so the
// rules the server enforces are visible in the UI rather than found out by a 400.
import type { RouteAttempt, RouteListItem } from "@/api/adapters";
import type { PickOption } from "@/features/routes/PickList";
import { formatDate, formatDuration, formatInteger } from "@/lib/format";

export interface MergeCandidateOption {
  route: RouteListItem;
  /** Shared ground, 0..1, as the clusterer measures it. */
  similarity: number;
  metresAway: number;
}

/**
 * The routes that can be folded into this one, most alike first.
 *
 * The scores come from the server, which has the geometry; the names, maps and counts
 * come from the list the page already holds. Joined here so neither side has to carry
 * the other's fields.
 *
 * A candidate the list does not know about is dropped rather than shown half-formed:
 * the two can only disagree if a sync landed between the requests, and a row with no
 * map is the one thing this dialog exists to avoid.
 */
export function mergeCandidates(
  routes: readonly RouteListItem[],
  scored: readonly { route_id: number; similarity: number; metres_away: number }[],
  target: { id: number; activityType: string },
): MergeCandidateOption[] {
  const byId = new Map(routes.map((route) => [route.id, route]));
  const out: MergeCandidateOption[] = [];

  for (const candidate of scored) {
    const route = byId.get(candidate.route_id);
    if (!route || route.id === target.id || route.activityType !== target.activityType) {
      continue;
    }
    out.push({
      route,
      similarity: candidate.similarity,
      metresAway: candidate.metres_away,
    });
  }
  return out;
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
