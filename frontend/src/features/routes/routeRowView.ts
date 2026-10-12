// One route's row, already formatted. Pure, so the table below it holds no logic and
// the formatting is tested without rendering anything.
import type { RouteListItem } from "@/api/adapters";
import { activityTypeLabel, type ActivityKind } from "@/lib/activityKind";
import { formatDate, formatDistance, formatDuration, formatInteger } from "@/lib/format";
import { LAYOUT_LABELS } from "@/features/routes/routeLayout";

export interface RouteRowView {
  id: number;
  href: string;
  name: string;
  kind: ActivityKind;
  /** The raw Garmin type, which `MergeRoutesDialog` filters its candidates by. */
  activityType: string;
  typeLabel: string;
  /** "Loop", "Out and back" or "One way": the shape the clusterer found. */
  shape: string;
  attempts: string;
  /** One time round: a loop's lap, an out-and-back there and back once. */
  distance: string;
  /** Times for that one time round: a loop's laps, any other route's attempts. */
  best: string;
  median: string;
  /** The day of the first attempt, shown once a card is opened. */
  first: string;
  /** The day of the most recent attempt. */
  last: string;
  /** The route's shape for the card's map; null for one with too few points. */
  polyline: string | null;
}

export function toRouteRowView(route: RouteListItem, today: Date = new Date()): RouteRowView {
  return {
    id: route.id,
    href: `/routes/${route.id}`,
    name: route.name,
    kind: route.kind,
    activityType: route.activityType,
    typeLabel: activityTypeLabel(route.activityType),
    shape: LAYOUT_LABELS[route.layout],
    attempts: formatInteger(route.attempts),
    distance: formatDistance(route.distanceM),
    // Round a loop, an attempt is any number of laps, so its time is no record: the lap is.
    best: formatDuration(route.layout === "loop" ? route.bestLapS : route.bestTimeS),
    median: formatDuration(route.layout === "loop" ? route.medianLapS : route.medianTimeS),
    first: formatDate(route.firstDay, today),
    last: formatDate(route.lastDay, today),
    polyline: route.polyline,
  };
}
