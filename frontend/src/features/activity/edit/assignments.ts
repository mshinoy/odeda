// The Edit dialog's gear and route selects, as pure functions. Gear and the route are
// not editable fields: they live in their own tables and have their own endpoints, so
// they are tracked beside the form's values and saved with their own requests.
import type { GearItem, RouteOption } from "@/api/adapters";
import type { ActivityKind } from "@/lib/activityKind";
import { formatInteger } from "@/lib/format";

/** A select's value: a gear or route id as a string, or "" for none. */
export type AssignmentValue = string;

export interface AssignmentValues {
  /** Gear kind ("shoe", "bike", ...) to the id selected for it. */
  gear: Record<string, AssignmentValue>;
  route: AssignmentValue;
}

/** What each gear kind is called, and the order the selects appear in. */
const GEAR_KINDS: ReadonlyArray<readonly [kind: string, label: string]> = [
  ["shoe", "Shoes"],
  ["bike", "Bike"],
  ["strap", "HR strap"],
  ["other", "Other gear"],
];

/** The gear kind a sport implies. A kind no sport claims (a strap) suits any of them. */
const KIND_FOR_SPORT: Readonly<Partial<Record<ActivityKind, string>>> = {
  run: "shoe",
  walk: "shoe",
  ride: "bike",
};

const SPORT_KINDS = new Set(Object.values(KIND_FOR_SPORT));

export function gearKindLabel(kind: string): string {
  return GEAR_KINDS.find(([name]) => name === kind)?.[1] ?? "Gear";
}

/**
 * Which gear selects to show: the sport's own kind, the kinds no sport claims, and
 * whatever is already on this activity — so no assignment is ever invisible, and so
 * unremovable. A kind the owner has no gear of is left out rather than shown empty,
 * and a run is never asked which bike it was on. The sport's kind comes first.
 */
export function gearKinds(
  activityKind: ActivityKind,
  gear: readonly GearItem[],
  assigned: readonly GearItem[],
): string[] {
  const sport = KIND_FOR_SPORT[activityKind];
  const present = new Set<string>();
  for (const item of gear) if (!item.retired) present.add(item.kind);
  const wanted = (kind: string) =>
    (present.has(kind) && (kind === sport || !SPORT_KINDS.has(kind))) ||
    assigned.some((item) => item.kind === kind);

  const known = GEAR_KINDS.map(([kind]) => kind).filter(wanted);
  if (sport === undefined || !known.includes(sport)) return known;
  return [sport, ...known.filter((kind) => kind !== sport)];
}

/**
 * One select's options: the kind's gear, retired items left out unless this activity
 * wears one — the shoes you ran in a year ago are retired now, and picking a different
 * pair must not be the only way to close the dialog.
 */
export function gearOptions(
  gear: readonly GearItem[],
  kind: string,
  assignedId: number | null,
): GearItem[] {
  return gear.filter((item) => item.kind === kind && (!item.retired || item.id === assignedId));
}

/** How a gear option reads: its name, and "(retired)" when it is. */
export function gearOptionLabel(item: GearItem): string {
  return item.retired ? `${item.name} (retired)` : item.name;
}

/**
 * The route options for an activity: the routes clustered from its own sport, plus the
 * route it is on when that was a manual move onto another sport's route.
 */
export function routeOptions(
  routes: readonly RouteOption[],
  activityType: string,
  assignedId: number | null,
): RouteOption[] {
  return routes.filter((route) => route.activityType === activityType || route.id === assignedId);
}

/**
 * How a route option reads. Its attempt count rather than its distance: a clustered
 * route is named after its distance already, and how often you have run it is what
 * tells two routes of the same length apart.
 */
export function routeOptionLabel(route: RouteOption): string {
  return `${route.name} · ${formatInteger(route.attempts)}×`;
}

/**
 * The selects' starting values, from what the activity already carries. Keyed by gear
 * kind rather than by the selects on screen, so it does not wait for the gear list.
 */
export function toAssignmentValues(
  assigned: readonly GearItem[],
  routeId: number | null,
): AssignmentValues {
  const gear: Record<string, AssignmentValue> = {};
  for (const item of assigned) gear[item.kind] = String(item.id);
  return { gear, route: routeId === null ? "" : String(routeId) };
}

export interface AssignmentChanges {
  /** The activity's whole new gear set, or null when no select moved. */
  gearIds: number[] | null;
  /** The route to move it to, or null when the route select did not move. */
  routeId: number | null;
}

/**
 * What to send. Gear goes as the whole set, so it carries removals as well as
 * additions; `initial` is keyed by every kind on the activity, so no assigned item can
 * fall out of the set unseen. A route is only ever moved, never unset: there is no
 * endpoint that takes an activity off a route.
 */
export function assignmentChanges(
  initial: AssignmentValues,
  current: AssignmentValues,
): AssignmentChanges {
  const kinds = new Set([...Object.keys(initial.gear), ...Object.keys(current.gear)]);
  const value = (values: AssignmentValues, kind: string) => values.gear[kind] ?? "";
  const moved = [...kinds].some((kind) => value(initial, kind) !== value(current, kind));
  const gearIds = [...kinds]
    .map((kind) => Number(value(current, kind)))
    .filter((id) => Number.isInteger(id) && id > 0);

  return {
    gearIds: moved ? gearIds : null,
    routeId: current.route !== initial.route && current.route !== "" ? Number(current.route) : null,
  };
}

/** True when a save has something to send. */
export function hasAssignmentChanges(changes: AssignmentChanges): boolean {
  return changes.gearIds !== null || changes.routeId !== null;
}
