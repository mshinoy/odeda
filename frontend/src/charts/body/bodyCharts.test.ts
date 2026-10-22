import { describe, expect, it } from "vitest";
import type { BodySeries } from "@/api/queries/useBody";
import {
  buildMassSplitOption,
  hasSplit,
  MASS_SERIES,
  MIN_MASS_SPAN_KG,
  massColors,
  changeFromStart,
  massScale,
  massTooltip,
} from "@/charts/body/buildMassSplitOption";
import {
  buildWeightTrendOption,
  MIN_WEIGHT_SPAN_KG,
  READING_OPACITY,
  TREND_LABEL,
  weightScale,
  weightTooltip,
} from "@/charts/body/buildWeightTrendOption";
import { colorTokens } from "@/design/tokens";

const tokens = colorTokens.light;
const today = new Date(2026, 8, 24);

/** Three days, the middle one with no weigh-in — the shape the axis has to cope with. */
const series: BodySeries = {
  days: ["2026-09-22", "2026-09-23", "2026-09-24"],
  weight_kg: [76.8, null, 76.2],
  trend_kg: [76.8, 76.8, 76.74],
  fat_kg: [13.9, 13.9, 13.8],
  lean_kg: [62.9, 62.9, 62.94],
  fat_pct: [18.1, 18.1, 18.11],
};

const weightOnly: BodySeries = {
  ...series,
  fat_kg: [null, null, null],
  lean_kg: [null, null, null],
};

const empty: BodySeries = {
  days: [],
  weight_kg: [],
  trend_kg: [],
  fat_kg: [],
  lean_kg: [],
  fat_pct: [],
};

/** ECharts types `series` as one-or-many; every chart test in this folder narrows it. */
function seriesOf(option: { series?: unknown }): Record<string, unknown>[] {
  return Array.isArray(option.series) ? (option.series as Record<string, unknown>[]) : [];
}

describe("weight trend", () => {
  it("draws the trend as the line and the readings as dots", () => {
    // The whole argument of the section, expressed as chart types: a line through the
    // raw readings would read as a second, equally valid answer.
    const option = buildWeightTrendOption({ series, tokens, today });
    const types = seriesOf(option).map((s) => s.type);
    expect(types).toEqual(["scatter", "line"]);
    expect(seriesOf(option)[1]?.name).toBe(TREND_LABEL);
  });

  it("keeps the readings faint", () => {
    const option = buildWeightTrendOption({ series, tokens, today });
    const scatter = seriesOf(option)[0];
    expect(scatter?.itemStyle).toMatchObject({ opacity: READING_OPACITY });
  });

  it("gives a steady month a minimum span rather than filling the chart with noise", () => {
    const steady: BodySeries = { ...series, weight_kg: [76.0, 76.1, 76.0] };
    const scale = weightScale(steady);
    expect(scale).not.toBeNull();
    expect((scale?.max ?? 0) - (scale?.min ?? 0)).toBeGreaterThanOrEqual(MIN_WEIGHT_SPAN_KG);
  });

  it("bounds the axis to the readings, which sit further out than the trend", () => {
    // Scaling to the trend alone would clip the dots the chart exists to show.
    const spread: BodySeries = {
      ...series,
      weight_kg: [80.0, null, 72.0],
      trend_kg: [76.0, 76.0, 76.0],
    };
    const scale = weightScale(spread);
    expect(scale?.min).toBeLessThanOrEqual(72);
    expect(scale?.max).toBeGreaterThanOrEqual(80);
  });

  it("has no scale when nothing was weighed", () => {
    expect(weightScale(empty)).toBeNull();
  });

  it("puts the trend second in the tooltip and marks a day with no reading", () => {
    expect(weightTooltip(series, 0, today)).toBe("Sep 22 · 76.8 kg · trend 76.8");
    expect(weightTooltip(series, 1, today)).toBe("Sep 23 · – · trend 76.8");
  });

  it("never joins the trend across a period with no scale at all", () => {
    const option = buildWeightTrendOption({ series, tokens, today });
    expect(seriesOf(option)[1]).toMatchObject({ connectNulls: false });
  });

  it("uses one y-axis", () => {
    const option = buildWeightTrendOption({ series, tokens, today });
    expect(Array.isArray(option.yAxis)).toBe(false);
  });
});

describe("fat and lean mass", () => {
  it("draws lean above fat, each in its own series colour", () => {
    const option = buildMassSplitOption({ series, tokens, today });
    expect(seriesOf(option).map((s) => s.name)).toEqual(["Lean", "Fat"]);
    expect(seriesOf(option)[0]?.color).toBe(tokens.series[0]);
    expect(seriesOf(option)[1]?.color).toBe(tokens.series[1]);
  });

  it("gives the legend the same colours the chart uses", () => {
    // The two cannot drift apart, for the same reason the sleep legend cannot.
    const colors = massColors(tokens);
    const option = buildMassSplitOption({ series, tokens, today });
    const drawn = seriesOf(option);
    for (const [position, { label, index }] of MASS_SERIES.entries()) {
      expect(colors[label]).toBe(tokens.series[index]);
      expect(drawn[position]?.color).toBe(colors[label]);
    }
  });

  it("plots change, not levels", () => {
    // The whole point. Lean sits near 63 kg and fat near 14, so one axis over both
    // levels spans 50 kg and the 3 kg that actually moved is a pixel — two flat
    // parallel lines, which is the failure this chart exists to avoid.
    const drawn = seriesOf(buildMassSplitOption({ series, tokens, today }));
    const rounded = (data: unknown) =>
      (data as (number | null)[]).map((v) => (v === null ? null : Number(v.toFixed(2))));
    expect(rounded(drawn[0]?.data)).toEqual([0, 0, 0.04]);
    expect(rounded(drawn[1]?.data)).toEqual([0, 0, -0.1]);
  });

  it("puts zero on the axis however the block went", () => {
    // Both series start there by construction; an axis that excluded it would put the
    // origin of the whole chart off screen.
    const gained: BodySeries = { ...series, fat_kg: [13.9, 14.4, 15.0], lean_kg: [62.9, 63, 63.1] };
    for (const input of [series, gained]) {
      const scale = massScale(input);
      expect(scale?.min).toBeLessThanOrEqual(0);
      expect(scale?.max).toBeGreaterThanOrEqual(0);
    }
  });

  it("gives a steady block a minimum span", () => {
    const scale = massScale(series);
    expect((scale?.max ?? 0) - (scale?.min ?? 0)).toBeGreaterThanOrEqual(MIN_MASS_SPAN_KG);
  });

  it("leaves days before the first weigh-in null rather than zero", () => {
    // A zero would draw a flat line across a period with no scale in the house.
    expect(changeFromStart([null, 12.0, 11.0])).toEqual([null, 0, -1]);
    expect(changeFromStart([null, null])).toEqual([null, null]);
  });

  it("knows there is no split to draw when the scale measured no body fat", () => {
    expect(hasSplit(series)).toBe(true);
    expect(hasSplit(weightOnly)).toBe(false);
    expect(massScale(weightOnly)).toBeNull();
  });

  it("keeps the level in the tooltip, where a single number is allowed", () => {
    expect(massTooltip(series, 2, today)).toBe(
      "Sep 24 · lean 62.9 kg (0.0) · fat 13.8 (\u22120.1)",
    );
  });

  it("uses one y-axis", () => {
    const option = buildMassSplitOption({ series, tokens, today });
    expect(Array.isArray(option.yAxis)).toBe(false);
  });
});
