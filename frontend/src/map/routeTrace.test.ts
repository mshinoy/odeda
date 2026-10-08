import { describe, expect, it } from "vitest";
import { traceSvgPath } from "@/map/routeTrace";

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
