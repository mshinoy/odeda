import { describe, expect, it } from "vitest";
import type { ActivityGap } from "@/api/adapters";
import { gapNote } from "@/features/activity/gapNote";

const withEstimate: ActivityGap = {
  seconds: 1707,
  straightM: 7305,
  estimate: {
    path: [
      [51.4965, 25.3173],
      [51.559, 25.2837],
    ],
    lengthM: 8883,
    avgSpeedMps: 5.2,
    source: { activityId: "90000000012", day: "2026-10-24", name: "Doha Cycling" },
  },
};

describe("gapNote", () => {
  it("says how long was missed, and what the path was guessed from", () => {
    const note = gapNote(withEstimate, "ride");
    expect(note.heading).toBe("Not recorded for 28 min");
    expect(note.detail).toContain("Estimated from your Doha Cycling on Oct 24");
    expect(note.detail).toContain("about 8.9 km");
    expect(note.detail).toContain("18.7 km/h on average");
  });

  it("says the estimate is not in the totals", () => {
    expect(gapNote(withEstimate, "ride").detail).toContain("Not counted");
  });

  it("reads a run as a pace, not a speed", () => {
    expect(gapNote(withEstimate, "run").detail).toContain("/km on average");
  });

  it("says the path is not known, rather than drawing one, when nothing covers it", () => {
    const note = gapNote({ ...withEstimate, estimate: null }, "ride");
    expect(note.detail).toContain("7.3 km away in a straight line");
    expect(note.detail).toContain("path is not drawn");
  });

  it("copes with a source that has no name or day", () => {
    const gap = {
      ...withEstimate,
      estimate: withEstimate.estimate && {
        ...withEstimate.estimate,
        source: { activityId: "x", day: null, name: null },
      },
    };
    expect(gapNote(gap, "ride").detail).toContain("Estimated from your another activity");
  });
});
