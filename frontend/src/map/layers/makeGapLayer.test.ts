import { describe, expect, it } from "vitest";
import type { ActivityGap } from "@/api/adapters";
import { gapDashes } from "@/map/layers/makeGapLayer";

const path: [number, number][] = [
  [51.5, 25.0],
  [51.5, 25.01],
];

function gap(estimate: ActivityGap["estimate"]): ActivityGap {
  return { seconds: 1707, straightM: 7305, estimate };
}

describe("gapDashes", () => {
  it("cuts a gap's estimated path into dashes", () => {
    const dashes = gapDashes([
      gap({
        path,
        lengthM: 1113,
        avgSpeedMps: 5,
        source: { activityId: "a", day: null, name: null },
      }),
    ]);
    expect(dashes.length).toBeGreaterThanOrEqual(4);
    expect(dashes.every((d) => d.path.length >= 2)).toBe(true);
  });

  it("draws nothing for a gap whose path is not known", () => {
    expect(gapDashes([gap(null)])).toEqual([]);
  });

  it("draws nothing when there are no gaps", () => {
    expect(gapDashes([])).toEqual([]);
  });
});
