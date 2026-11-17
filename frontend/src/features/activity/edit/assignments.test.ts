import { describe, expect, it } from "vitest";
import type { GearItem, RouteOption } from "@/api/adapters";
import {
  assignmentChanges,
  gearKindLabel,
  gearKinds,
  gearOptionLabel,
  gearOptions,
  hasAssignmentChanges,
  routeOptionLabel,
  routeOptions,
  toAssignmentValues,
} from "@/features/activity/edit/assignments";

function gear(id: number, kind: string, name: string, retired = false): GearItem {
  return { id, kind, name, retired };
}

const NOVABLAST = gear(1, "shoe", "Novablast 4");
const CLIFTON = gear(2, "shoe", "Clifton 9");
const OLD_SHOES = gear(3, "shoe", "Pegasus 38", true);
const BIKE = gear(4, "bike", "Domane");
const STRAP = gear(5, "strap", "HRM-Pro");
const ALL = [NOVABLAST, CLIFTON, OLD_SHOES, BIKE, STRAP];

function route(id: number, name: string, activityType = "running", distanceM = 5000): RouteOption {
  return { id, name, activityType, distanceM, attempts: 12 };
}

describe("gearKinds", () => {
  it("offers the sport's own kind first, and never another sport's", () => {
    // A strap belongs to no sport in particular, so it is offered for both.
    expect(gearKinds("run", ALL, [])).toEqual(["shoe", "strap"]);
    expect(gearKinds("ride", ALL, [])).toEqual(["bike", "strap"]);
  });

  it("offers only the sportless kinds to a sport with gear of its own", () => {
    expect(gearKinds("swim", ALL, [])).toEqual(["strap"]);
    expect(gearKinds("strength", ALL, [])).toEqual(["strap"]);
  });

  it("offers a kind only when there is gear of it to pick", () => {
    expect(gearKinds("run", [NOVABLAST], [])).toEqual(["shoe"]);
    expect(gearKinds("ride", [NOVABLAST], [])).toEqual([]);
  });

  it("offers a kind the activity already carries, whatever the sport", () => {
    // Shoes on a ride are odd but they are there, and hiding them would make them
    // impossible to take off.
    expect(gearKinds("ride", ALL, [NOVABLAST])).toEqual(["bike", "shoe", "strap"]);
    // Retired gear counts the same way.
    expect(gearKinds("run", [OLD_SHOES], [])).toEqual([]);
    expect(gearKinds("run", [OLD_SHOES], [OLD_SHOES])).toEqual(["shoe"]);
  });
});

describe("gearOptions", () => {
  it("leaves retired items out", () => {
    expect(gearOptions(ALL, "shoe", null)).toEqual([NOVABLAST, CLIFTON]);
  });

  it("keeps the retired item the activity is wearing", () => {
    expect(gearOptions(ALL, "shoe", OLD_SHOES.id)).toEqual([NOVABLAST, CLIFTON, OLD_SHOES]);
  });

  it("labels a retired item as retired", () => {
    expect(gearOptionLabel(NOVABLAST)).toBe("Novablast 4");
    expect(gearOptionLabel(OLD_SHOES)).toBe("Pegasus 38 (retired)");
  });
});

describe("gearKindLabel", () => {
  it("names the kinds, and falls back for one it does not know", () => {
    expect(gearKindLabel("shoe")).toBe("Shoes");
    expect(gearKindLabel("strap")).toBe("HR strap");
    expect(gearKindLabel("kayak")).toBe("Gear");
  });
});

describe("routeOptions", () => {
  const corniche = route(1, "Corniche out and back");
  const localLoop = route(2, "Local loop", "cycling", 32000);
  const routes = [corniche, localLoop];

  it("offers the routes of the activity's own sport", () => {
    expect(routeOptions(routes, "running", null)).toEqual([corniche]);
  });

  it("keeps the route it is on, even from another sport", () => {
    // A manual move can put a run on a cycling route; the select must still show it.
    expect(routeOptions(routes, "running", 2)).toEqual(routes);
  });

  it("labels a route with how often it has been run", () => {
    expect(routeOptionLabel(corniche)).toBe("Corniche out and back · 12×");
  });
});

describe("toAssignmentValues", () => {
  it("reads the activity's own gear and route", () => {
    expect(toAssignmentValues([NOVABLAST, STRAP], 7)).toEqual({
      gear: { shoe: "1", strap: "5" },
      route: "7",
    });
  });

  it("is empty for an activity with neither", () => {
    expect(toAssignmentValues([], null)).toEqual({ gear: {}, route: "" });
  });
});

describe("assignmentChanges", () => {
  const initial = toAssignmentValues([NOVABLAST, STRAP], 7);

  it("sends nothing when nothing moved", () => {
    const changes = assignmentChanges(initial, initial);
    expect(changes).toEqual({ gearIds: null, routeId: null });
    expect(hasAssignmentChanges(changes)).toBe(false);
  });

  it("sends the whole gear set when one select moved", () => {
    const current = { ...initial, gear: { ...initial.gear, shoe: "2" } };
    // The strap is untouched and must stay on the activity.
    expect(assignmentChanges(initial, current)).toEqual({ gearIds: [2, 5], routeId: null });
  });

  it("sends a set without the item that was cleared", () => {
    const current = { ...initial, gear: { ...initial.gear, shoe: "" } };
    expect(assignmentChanges(initial, current)).toEqual({ gearIds: [5], routeId: null });
  });

  it("sends an empty set when every item was cleared", () => {
    const current = { ...initial, gear: { shoe: "", strap: "" } };
    const changes = assignmentChanges(initial, current);
    expect(changes.gearIds).toEqual([]);
    expect(hasAssignmentChanges(changes)).toBe(true);
  });

  it("picks up gear of a kind the activity had none of", () => {
    const current = { ...initial, gear: { ...initial.gear, bike: "4" } };
    expect(assignmentChanges(initial, current).gearIds).toEqual([1, 5, 4]);
  });

  it("sends the route only when it moved", () => {
    expect(assignmentChanges(initial, { ...initial, route: "9" }).routeId).toBe(9);
    // There is no endpoint that takes an activity off a route, so "None" sends nothing.
    expect(assignmentChanges(initial, { ...initial, route: "" }).routeId).toBeNull();
  });
});
