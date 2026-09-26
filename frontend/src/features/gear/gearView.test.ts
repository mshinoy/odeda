import { describe, expect, it } from "vitest";
import type { GearRecord } from "@/api/adapters";
import { sortGear, visibleGear, wearOf } from "@/features/gear/gearView";

function gear(patch: Partial<GearRecord> = {}): GearRecord {
  return {
    id: 1,
    kind: "shoe",
    name: "Novablast",
    retired: false,
    brand: "Asics",
    model: "Novablast 4",
    nickname: null,
    purchaseDate: null,
    notes: null,
    initialDistanceM: 0,
    retirementDistanceM: 800_000,
    totalDistanceM: 400_000,
    trackedDistanceM: 400_000,
    movingTimeS: 0,
    elevationGainM: 0,
    activityCount: 40,
    firstUse: null,
    lastUse: null,
    retirementPct: 50,
    remainingM: 400_000,
    state: "ok",
    distancePerWeekKm: null,
    ...patch,
  };
}

describe("wearOf", () => {
  it("reads the percentage the backend computed", () => {
    expect(wearOf(gear())).toEqual({ fraction: 0.5, state: "ok", pct: 50 });
  });

  it("clamps a bar that is past full, and keeps the honest percentage", () => {
    // A bar wider than its track is a layout bug; the number still says 137%.
    const worn = wearOf(gear({ retirementPct: 137, state: "over" }));
    expect(worn.fraction).toBe(1);
    expect(worn.pct).toBe(137);
  });

  it("draws nothing for an item with no retirement distance", () => {
    expect(wearOf(gear({ retirementDistanceM: null, retirementPct: null }))).toEqual({
      fraction: 0,
      state: "ok",
      pct: null,
    });
  });
});

describe("sortGear", () => {
  it("puts what needs replacing first, then mileage, retired last", () => {
    const sorted = sortGear([
      gear({ id: 1, state: "retired", totalDistanceM: 900_000, retired: true }),
      gear({ id: 2, state: "ok", totalDistanceM: 100_000 }),
      gear({ id: 3, state: "over" }),
      gear({ id: 4, state: "ok", totalDistanceM: 500_000 }),
      gear({ id: 5, state: "warn" }),
    ]);

    expect(sorted.map((item) => item.id)).toEqual([3, 5, 4, 2, 1]);
  });

  it("does not reorder its argument", () => {
    const input = [gear({ id: 1, state: "retired" }), gear({ id: 2, state: "over" })];
    sortGear(input);
    expect(input.map((item) => item.id)).toEqual([1, 2]);
  });
});

describe("visibleGear", () => {
  const all = [gear({ id: 1 }), gear({ id: 2, retired: true, state: "retired" })];

  it("hides retired items until asked", () => {
    expect(visibleGear(all, false).map((item) => item.id)).toEqual([1]);
    expect(visibleGear(all, true).map((item) => item.id)).toEqual([1, 2]);
  });
});
