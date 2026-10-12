// Which kinds the routes contain, and the filtering itself. Pure, so the control above
// the list holds no logic and this is tested without rendering anything.
import type { RouteRowView } from "@/features/routes/routeRowView";
import type { ActivityKind } from "@/lib/activityKind";

/** `null` is "all of them", which is not a kind and so is not in this map. */
export const KIND_LABEL: Readonly<Record<ActivityKind, string>> = {
  run: "Run",
  ride: "Ride",
  walk: "Walk",
  swim: "Swim",
  strength: "Strength",
  other: "Other",
};

/** Offered in this order when present, rather than by count: a list whose buttons move
 *  around after a sync is a list you have to read before you can click. */
const ORDER: readonly ActivityKind[] = ["run", "ride", "walk", "swim", "strength", "other"];

export interface KindOption {
  kind: ActivityKind;
  label: string;
  count: number;
}

/**
 * One option per kind that actually has routes, in a fixed order.
 *
 * Kinds with nothing in them are left out: a Swim button that always gives an empty
 * list is a control lying about what the data holds. Routes come from GPS tracks, so
 * Strength never appears at all.
 */
export function kindOptions(rows: readonly RouteRowView[]): KindOption[] {
  const counts = new Map<ActivityKind, number>();
  for (const row of rows) counts.set(row.kind, (counts.get(row.kind) ?? 0) + 1);

  return ORDER.filter((kind) => counts.has(kind)).map((kind) => ({
    kind,
    label: KIND_LABEL[kind],
    count: counts.get(kind) ?? 0,
  }));
}

/** The rows to show. `null` keeps all of them. */
export function filterByKind(
  rows: readonly RouteRowView[],
  kind: ActivityKind | null,
): RouteRowView[] {
  return kind === null ? [...rows] : rows.filter((row) => row.kind === kind);
}

/**
 * The kind named in the URL, or null for all.
 *
 * Anything unrecognised reads as null rather than an empty list: a stale or hand-typed
 * `?kind=cycling` should show the routes, not an empty page with no way back.
 */
export function parseKind(value: string | null): ActivityKind | null {
  return value !== null && value in KIND_LABEL ? (value as ActivityKind) : null;
}
