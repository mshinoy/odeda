import { describe, expect, it } from "vitest";
import {
  decimalStep,
  padded,
  quantileRange,
  SECONDS_STEPS,
  snapToStep,
  stepFrom,
  withMinSpan,
} from "@/charts/axisScale";

describe("decimalStep", () => {
  it("picks 1, 2 or 5 times a power of ten", () => {
    expect(decimalStep(10.4, 5)).toBe(5);
    expect(decimalStep(9, 5)).toBe(2);
    expect(decimalStep(0.8, 5)).toBe(0.2);
    expect(decimalStep(40, 3)).toBe(20);
  });

  it("falls back to 1 for an empty span", () => {
    expect(decimalStep(0, 3)).toBe(1);
  });
});

describe("stepFrom", () => {
  it("picks the smallest candidate that fits", () => {
    expect(stepFrom(SECONDS_STEPS, 80, 3)).toBe(30);
    expect(stepFrom(SECONDS_STEPS, 25, 3)).toBe(10);
  });

  it("goes decimal past the list", () => {
    expect(stepFrom([1, 2], 90, 3)).toBe(50);
  });
});

describe("quantileRange", () => {
  it("is the min and max at [0, 1], skipping nulls", () => {
    expect(quantileRange([3, null, 1, 2], 0, 1)).toEqual([1, 3]);
  });

  it("drops the outer samples at inner quantiles", () => {
    const values = [...Array.from({ length: 98 }, () => 5), 0, 100];
    expect(quantileRange(values, 0.02, 0.98)).toEqual([5, 5]);
  });

  it("is null without finite values", () => {
    expect(quantileRange([null, Number.NaN], 0, 1)).toBeNull();
  });
});

describe("range helpers", () => {
  it("grows a range to a minimum span around its centre", () => {
    expect(withMinSpan([100, 102], 10)).toEqual([96, 106]);
    expect(withMinSpan([0, 50], 10)).toEqual([0, 50]);
  });

  it("pads both sides", () => {
    expect(padded([0, 100], 0.05)).toEqual([-5, 105]);
  });

  it("snaps outwards to the step without float noise", () => {
    expect(snapToStep([0.31, 0.89], 0.1)).toEqual([0.3, 0.9]);
    expect(snapToStep([141, 172], 10)).toEqual([140, 180]);
  });
});
