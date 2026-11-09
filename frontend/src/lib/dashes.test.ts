import { describe, expect, it } from "vitest";
import { dashPaths } from "@/lib/dashes";

// About 111 m per 0.001 degree of latitude, so a straight line north is easy to measure.
const north: [number, number][] = [
  [51.5, 25.0],
  [51.5, 25.01],
];

describe("dashPaths", () => {
  it("cuts a line into dashes with a gap between each", () => {
    const dashes = dashPaths(north, 100, 100);
    // 1,113 m: dash, gap, dash, gap... 100 m each, so about six dashes.
    expect(dashes.length).toBeGreaterThanOrEqual(5);
    expect(dashes.length).toBeLessThanOrEqual(6);
    const first = dashes[0];
    const second = dashes[1];
    expect(first?.[0]).toEqual([51.5, 25.0]);
    // The second dash starts after the first one's 100 m plus a 100 m gap.
    const gapDegrees = (second?.[0]?.[1] ?? 0) - (first?.[1]?.[1] ?? 0);
    expect(gapDegrees * 111_320).toBeCloseTo(100, 0);
  });

  it("makes no dash of a line shorter than nothing", () => {
    expect(dashPaths([], 10, 10)).toEqual([]);
    expect(dashPaths([[51.5, 25.0]], 10, 10)).toEqual([]);
    expect(
      dashPaths(
        [
          [51.5, 25.0],
          [51.5, 25.0],
        ],
        10,
        10,
      ),
    ).toEqual([]);
  });

  it("draws a line shorter than one dash as a single dash", () => {
    const short: [number, number][] = [
      [51.5, 25.0],
      [51.5, 25.0003],
    ];
    expect(dashPaths(short, 100, 100)).toEqual([short]);
  });

  it("keeps a bend inside a dash", () => {
    const bent: [number, number][] = [
      [51.5, 25.0],
      [51.5, 25.0003],
      [51.5003, 25.0003],
    ];
    const [dash] = dashPaths(bent, 200, 50);
    expect(dash).toHaveLength(3);
    expect(dash?.[1]).toEqual([51.5, 25.0003]);
  });

  it("never draws more than the line it was given", () => {
    const total = dashPaths(north, 100, 100).flatMap((d) => d);
    for (const [, lat] of total) expect(lat).toBeLessThanOrEqual(25.01);
  });
});
