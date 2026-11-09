import { describe, expect, it } from "vitest";
import { traceSvgPath, traceSvgPaths } from "@/map/routeTrace";

describe("traceSvgPath", () => {
  it("fits a route into the box, centred, north up", () => {
    // A north-south line on the equator: no longitude to narrow.
    expect(
      traceSvgPath(
        [
          [0, 0],
          [1, 0],
        ],
        100,
        60,
        10,
      ),
    ).toBe("M50.0 50.0 L50.0 10.0");
  });

  it("keeps the shape: a square route stays square in a wide box", () => {
    const square: [number, number][] = [
      [0, 0],
      [0, 1],
      [1, 1],
      [1, 0],
    ];
    expect(traceSvgPath(square, 200, 100, 0)).toBe("M50.0 100.0 L150.0 100.0 L150.0 0.0 L50.0 0.0");
  });

  it("draws nothing for a point or a standstill", () => {
    expect(traceSvgPath([[1, 1]], 100, 100, 0)).toBe("");
    expect(
      traceSvgPath(
        [
          [1, 1],
          [1, 1],
        ],
        100,
        100,
        0,
      ),
    ).toBe("");
  });
});

describe("traceSvgPaths", () => {
  const a: [number, number][] = [
    [25.0, 51.0],
    [25.1, 51.0],
  ];
  const b: [number, number][] = [
    [25.1, 51.1],
    [25.0, 51.1],
  ];

  it("starts each piece with its own move, so no line joins them", () => {
    const d = traceSvgPaths([a, b], 100, 100, 10);
    expect(d.match(/M/g)).toHaveLength(2);
    expect(d.match(/L/g)).toHaveLength(2);
  });

  it("fits every piece into the one box", () => {
    const together = traceSvgPaths([a, b], 100, 100, 10);
    const alone = traceSvgPaths([a], 100, 100, 10);
    expect(together).not.toBe(alone);
  });

  it("matches traceSvgPath for a single piece", () => {
    expect(traceSvgPaths([a], 100, 100, 10)).toBe(traceSvgPath(a, 100, 100, 10));
  });
});
