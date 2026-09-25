// One route's row, already formatted. Pure, so the table below it holds no logic and
// the formatting is tested without rendering anything.
import type { RouteListItem } from "@/api/adapters";
import { activityTypeLabel, type ActivityKind } from "@/lib/activityKind";
import { formatDate, formatDistance, formatDuration, formatInteger } from "@/lib/format";

export interface RouteRowView {
  id: number;
  href: string;
  name: string;
  kind: ActivityKind;
  typeLabel: string;
  /** "Loop" or "Out and back": the shape the clusterer found. */
  shape: string;
  attempts: string;
  distance: string;
  best: string;
  median: string;
  /** The day of the most recent attempt. */
  last: string;
}

export function toRouteRowView(route: RouteListItem, today: Date = new Date()): RouteRowView {
  return {
    id: route.id,
    href: `/routes/${route.id}`,
    name: route.name,
    kind: route.kind,
    typeLabel: activityTypeLabel(route.activityType),
    shape: route.isLoop ? "Loop" : "Out and back",
    attempts: formatInteger(route.attempts),
    distance: formatDistance(route.distanceM),
    best: formatDuration(route.bestTimeS),
    median: formatDuration(route.medianTimeS),
    last: formatDate(route.lastDay, today),
  };
}
