import { describe, expect, it } from "vitest";
import {
  hexToRgba,
  hrZoneColor,
  kindColor,
  metricColor,
  normalize,
  percentileRange,
} from "@/design/scales";
import { colorTokens } from "@/design/tokens";

const light = colorTokens.light;
const dark = colorTokens.dark;

describe("kindColor", () => {
  it("gives run, ride and swim their own colours and folds the rest to neutral", () => {
    const colours = new Set([
      kindColor(light, "run"),
      kindColor(light, "ride"),
      kindColor(light, "swim"),
    ]);
    expect(colours.size).toBe(3);
    expect(kindColor(light, "walk")).toBe(kindColor(light, "other"));
  });
});

describe("hrZoneColor", () => {
  it("maps zones 1-5 and clamps outside", () => {
    expect(hrZoneColor(light, 1)).toBe(light.hrZones[0]);
    expect(hrZoneColor(light, 5)).toBe(light.hrZones[4]);
    expect(hrZoneColor(light, 0)).toBe(light.hrZones[0]);
    expect(hrZoneColor(light, 9)).toBe(light.hrZones[4]);
  });
});

describe("percentileRange", () => {
  it("ignores nulls and the outer 5% at each end", () => {
    const values = [null, ...Array.from({ length: 99 }, (_, i) => i + 1), 10_000];
    // 100 numbers: indices round(0.05 * 99) = 5 and round(0.95 * 99) = 94.
    expect(percentileRange(values)).toEqual([6, 95]);
  });

  it("widens a flat series so normalize never divides by zero", () => {
    expect(percentileRange([5, 5, 5])).toEqual([5, 6]);
  });

  it("is null with no numbers", () => {
    expect(percentileRange([null, null])).toBeNull();
  });
});

describe("normalize and metricColor", () => {
  it("clamps to the ends of the ramp", () => {
    expect(normalize(-3, [0, 10])).toBe(0);
    expect(normalize(30, [0, 10])).toBe(1);
    expect(metricColor(light, 0)).toBe(light.metricRamp[0]);
    expect(metricColor(light, 1)).toBe(light.metricRamp.at(-1));
  });

  it("runs dark-to-light in dark mode, so high values are the brightest", () => {
    expect(metricColor(dark, 1)).toBe("#cde2fb");
  });
});

describe("hexToRgba", () => {
  it("converts for deck.gl", () => {
    expect(hexToRgba("#2a78d6")).toEqual([42, 120, 214, 255]);
    expect(hexToRgba("#2a78d6", 128)).toEqual([42, 120, 214, 128]);
  });
});
