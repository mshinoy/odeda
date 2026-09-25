import { describe, expect, it } from "vitest";
import { evenGrid, GRID_POINTS, resampleOnto } from "@/charts/compareChart/resample";

describe("evenGrid", () => {
  it("runs from zero to the maximum", () => {
    expect(evenGrid(10, 5)).toEqual([0, 2.5, 5, 7.5, 10]);
  });

  it("defaults to the plotting grid", () => {
    expect(evenGrid(10)).toHaveLength(GRID_POINTS);
  });
});

describe("resampleOnto", () => {
  const xs = [0, 1, 2, 3];
  const ys = [10, 20, 30, 40];

  it("reads a sample straight through where the grid lands on one", () => {
    expect(resampleOnto(xs, ys, [0, 1, 2, 3])).toEqual([10, 20, 30, 40]);
  });

  it("interpolates between the samples either side", () => {
    expect(resampleOnto(xs, ys, [0.5, 2.25])).toEqual([15, 32.5]);
  });

  it("is null past the end, so a shorter activity simply stops", () => {
    expect(resampleOnto(xs, ys, [3, 3.5, 9])).toEqual([40, null, null]);
  });

  it("keeps a gap in the recording a gap", () => {
    // Nothing was recorded between 1 and 2, so nothing is read there.
    expect(resampleOnto(xs, [10, null, 30, 40], [0.5, 1.5, 2.5])).toEqual([null, null, 35]);
  });

  it("survives repeated x values, which a paused watch produces", () => {
    expect(resampleOnto([0, 1, 1, 2], [10, 20, 22, 30], [1, 1.5])).toEqual([20, 26]);
  });

  it("has nothing to read from an activity with no samples", () => {
    expect(resampleOnto([], [], [0, 1, 2])).toEqual([null, null, null]);
  });

  it("walks the whole grid in one pass, whatever the order of the reads", () => {
    const manyXs = Array.from({ length: 500 }, (_, i) => i * 0.37);
    const manyYs = manyXs.map((x) => x * 2);
    const grid = evenGrid(manyXs[manyXs.length - 1] ?? 0, 50);
    const read = resampleOnto(manyXs, manyYs, grid);
    read.forEach((value, i) => expect(value).toBeCloseTo((grid[i] ?? 0) * 2, 6));
  });
});
