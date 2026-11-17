import { describe, expect, it } from "vitest";
import {
  compareBlockedReason,
  compareHref,
  MAX_COMPARE,
  parseCompareIds,
  racesAtThisDistance,
} from "@/features/compare/compareSelection";

describe("compareHref and parseCompareIds", () => {
  it("round-trips a selection in the order it was picked", () => {
    const ids = ["90000000011", "90000000010"];
    expect(parseCompareIds(new URL(`http://x${compareHref(ids)}`).searchParams.get("ids"))).toEqual(
      ids,
    );
  });

  it("ignores blanks and stray spaces in a hand-edited URL", () => {
    expect(parseCompareIds(" a , ,b ")).toEqual(["a", "b"]);
    expect(parseCompareIds(null)).toEqual([]);
  });

  it("caps at what the view can draw, so a long URL cannot overload it", () => {
    expect(parseCompareIds("a,b,c,d,e,f,g")).toHaveLength(MAX_COMPARE);
  });
});

describe("compareBlockedReason", () => {
  it("says how many more are needed", () => {
    expect(compareBlockedReason(0)).toBe("Pick 2 more to compare.");
    expect(compareBlockedReason(1)).toBe("Pick 1 more to compare.");
  });

  it("is silent for a selection that can be compared", () => {
    expect(compareBlockedReason(2)).toBeNull();
    expect(compareBlockedReason(MAX_COMPARE)).toBeNull();
  });

  it("says how many to unpick above the limit", () => {
    expect(compareBlockedReason(7)).toBe("Compare at most 5; unpick 2.");
  });
});

describe("racesAtThisDistance", () => {
  const half = { id: "half", day: "2026-01-10", distanceM: 21097 };

  it("puts this race first, then the most recent others within 10%", () => {
    const races = [
      half,
      { id: "older", day: "2024-02-02", distanceM: 21100 },
      { id: "newer", day: "2025-03-03", distanceM: 20500 },
    ];
    expect(racesAtThisDistance(half, races).map((r) => r.id)).toEqual(["half", "newer", "older"]);
  });

  it("leaves out a race of another distance", () => {
    const tenK = { id: "10k", day: "2025-05-05", distanceM: 10000 };
    expect(racesAtThisDistance(half, [half, tenK])).toEqual([]);
  });

  it("never offers more than the view can draw", () => {
    const many = Array.from({ length: 9 }, (_, i) => ({
      id: `r${i}`,
      day: `2025-0${i + 1}-01`,
      distanceM: 21097,
    }));
    expect(racesAtThisDistance(half, [half, ...many])).toHaveLength(MAX_COMPARE);
  });

  it("has nothing to offer for an activity with no distance", () => {
    const indoor = { id: "gym", day: "2026-01-10", distanceM: null };
    expect(racesAtThisDistance(indoor, [indoor, half])).toEqual([]);
  });

  it("has nothing to offer when no other race is close", () => {
    expect(racesAtThisDistance(half, [half])).toEqual([]);
  });
});
