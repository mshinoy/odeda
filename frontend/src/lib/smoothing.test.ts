import { describe, expect, it } from "vitest";
import { centredMean, rollingMean } from "@/lib/smoothing";

const seconds = (n: number, step = 1) => Array.from({ length: n }, (_, i) => i * step);

describe("rollingMean", () => {
  it("leaves a constant stream unchanged", () => {
    const values = Array.from({ length: 100 }, () => 3);
    expect(rollingMean(values, seconds(100), 30)).toEqual(values);
  });

  it("averages over the window centred on each sample", () => {
    // Window 4 s = 2 s either side. At t=2: samples t=0..4 → (0+1+2+3+4)/5 = 2.
    // At t=0 only t=0..2 are in reach → (0+1+2)/3 = 1.
    const values = [0, 1, 2, 3, 4, 5];
    const smoothed = rollingMean(values, seconds(6), 4);
    expect(smoothed[0]).toBeCloseTo(1);
    expect(smoothed[2]).toBeCloseTo(2);
    expect(smoothed[5]).toBeCloseTo(4); // (3+4+5)/3
  });

  it("spreads a one-sample spike across the window", () => {
    // 31 samples inside a 30 s window around t=50: the spike adds 31/31 = 1 m/s to the mean.
    const values = seconds(101).map((t) => (t === 50 ? 34 : 3));
    const smoothed = rollingMean(values, seconds(101), 30);
    expect(smoothed[50]).toBeCloseTo(4);
    expect(smoothed[0]).toBeCloseTo(3);
  });

  it("measures the window in seconds, not samples", () => {
    // Samples 10 s apart: a 30 s window reaches one neighbour on each side.
    const values = [10, 20, 30, 40];
    const smoothed = rollingMean(values, seconds(4, 10), 30);
    expect(smoothed).toEqual([15, 20, 30, 35]);
  });

  it("keeps gaps and leaves them out of the neighbours' means", () => {
    const values = [2, null, 4, 6];
    const smoothed = rollingMean(values, seconds(4), 2);
    // t=0: (2)/1; t=1: gap; t=2: (4+6)/2 over t=1..3 without the gap; t=3: (4+6)/2.
    expect(smoothed).toEqual([2, null, 5, 5]);
  });

  it("is the identity for a zero-width window", () => {
    const values = [1, 5, null, 2];
    expect(rollingMean(values, seconds(4), 0)).toEqual(values);
  });

  it("handles an empty stream", () => {
    expect(rollingMean([], [], 30)).toEqual([]);
  });
});

describe("centredMean", () => {
  it("averages the window centred on each value", () => {
    // Window 3 at index 2: (3 + 4 + 5) / 3 = 4.
    expect(centredMean([1, 2, 3, 4, 5], 3)).toEqual([1.5, 2, 3, 4, 4.5]);
  });

  it("takes one more from the older side for an even window", () => {
    // Window 4 at index 3: indices 1..4 (two before, one after), (2 + 3 + 4 + 5) / 4 = 3.5.
    expect(centredMean([1, 2, 3, 4, 5], 4)).toEqual([1.5, 2, 2.5, 3.5, 4]);
  });

  it("averages what is there at the ends rather than going null", () => {
    // Index 0 of a window of 5 sees indices 0..2 only: (10 + 20 + 30) / 3 = 20.
    expect(centredMean([10, 20, 30, 40, 50], 5)[0]).toBe(20);
  });

  it("is the mean of everything once the window covers the series", () => {
    expect(centredMean([2, 4, 6], 99)).toEqual([4, 4, 4]);
  });

  it("is the identity for a window of one", () => {
    expect(centredMean([3, 1, 2], 1)).toEqual([3, 1, 2]);
  });

  it("handles an empty series", () => {
    expect(centredMean([], 10)).toEqual([]);
  });
});
