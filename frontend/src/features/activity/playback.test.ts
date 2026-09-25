import { describe, expect, it } from "vitest";
import { advance, indexAtElapsed, resumeFrom, trackDuration } from "@/features/activity/playback";

describe("trackDuration", () => {
  it("is the last elapsed value", () => {
    expect(trackDuration([0, 30, 61.5])).toBe(61.5);
  });

  it("is zero for an activity with no samples", () => {
    expect(trackDuration([])).toBe(0);
  });
});

describe("advance", () => {
  it("moves by the frame's worth of activity time", () => {
    // One 16 ms frame at 100x is 1.6 s of the run.
    expect(advance(0, 16, 100, 3600)).toBeCloseTo(1.6, 5);
  });

  it("stops at the end rather than running past it or looping", () => {
    expect(advance(3599, 1000, 100, 3600)).toBe(3600);
    expect(advance(3600, 1000, 100, 3600)).toBe(3600);
  });
});

describe("resumeFrom", () => {
  it("carries on from where it was paused", () => {
    expect(resumeFrom(1200, 3600)).toBe(1200);
  });

  it("starts again when play is pressed at the end", () => {
    expect(resumeFrom(3600, 3600)).toBe(0);
  });
});

describe("indexAtElapsed", () => {
  const elapsed = [0, 10, 20, 30, 40];

  it("is the last sample recorded at or before the time", () => {
    expect(indexAtElapsed(elapsed, 25)).toBe(2);
    expect(indexAtElapsed(elapsed, 30)).toBe(3);
  });

  it("clamps to the first and last samples", () => {
    expect(indexAtElapsed(elapsed, -5)).toBe(0);
    expect(indexAtElapsed(elapsed, 999)).toBe(4);
  });

  it("agrees with a linear scan over an uneven stream", () => {
    const uneven = [0, 1, 1, 4, 9, 9.5, 20];
    for (const t of [0, 0.5, 1, 3, 4, 9.4, 9.5, 19, 20, 21]) {
      const expected = uneven.reduce((best, value, i) => (value <= t ? i : best), 0);
      expect(indexAtElapsed(uneven, t)).toBe(expected);
    }
  });

  it("survives an empty stream", () => {
    expect(indexAtElapsed([], 10)).toBe(0);
  });
});
