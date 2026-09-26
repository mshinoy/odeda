import { describe, expect, it } from "vitest";
import type { PowerToWeightPoint, SpeedWeightPoint, WeightLoadPoint } from "@/api/queries/useBody";
import {
  buildPowerToWeightOption,
  MIN_WATTS_SPAN,
  powerScale,
  powerTooltip,
} from "@/charts/body/buildPowerToWeightOption";
import {
  buildSpeedWeightOption,
  indexColors,
  indexScale,
  INDEX_SERIES,
  MIN_INDEX_SPAN,
  speedWeightTooltip,
} from "@/charts/body/buildSpeedWeightOption";
import {
  buildWeightAgainstLoadOptions,
  loadColor,
  MIN_CTL_SPAN,
  panelScale,
  weightLoadTooltip,
} from "@/charts/body/buildWeightAgainstLoadOptions";
import { colorTokens } from "@/design/tokens";

const tokens = colorTokens.light;
const today = new Date(2026, 8, 24);

function seriesOf(option: { series?: unknown }): Record<string, unknown>[] {
  return Array.isArray(option.series) ? (option.series as Record<string, unknown>[]) : [];
}

/** A build block: CTL climbing 60 → 90 while the scale moves 2 kg. */
const loadPoints: WeightLoadPoint[] = [
  { day: "2026-07-01", trend_kg: 76.4, ctl: 60 },
  { day: "2026-08-01", trend_kg: 75.5, ctl: 75 },
  { day: "2026-09-01", trend_kg: 74.4, ctl: 90 },
];

const speedPoints: SpeedWeightPoint[] = [
  { week: "2026-07-06", speed_index: 100, weight_index: 100 },
  { week: "2026-07-13", speed_index: 106.2, weight_index: 98.4 },
  { week: "2026-07-20", speed_index: 114.4, weight_index: 95.3 },
];

const powerPoints: PowerToWeightPoint[] = [
  { day: "2026-07-05", activity_id: "a1", watts_per_kg: 2.31 },
  { day: "2026-08-20", activity_id: "a2", watts_per_kg: 2.64 },
];

describe("weight against training load", () => {
  it("is two panels, each with its own single y-axis", () => {
    // Kilograms and CTL are not the same quantity. One chart holding both either
    // flattens the weight into a straight line or scales it against a second axis
    // nobody can see, which is worse than an honest second axis and also not allowed.
    const { weight, load } = buildWeightAgainstLoadOptions({ points: loadPoints, tokens, today });
    expect(Array.isArray(weight.yAxis)).toBe(false);
    expect(Array.isArray(load.yAxis)).toBe(false);
    expect(seriesOf(weight)).toHaveLength(1);
    expect(seriesOf(load)).toHaveLength(1);
  });

  it("gives both panels the same x axis and the same gutters, so they line up", () => {
    // The panels are read by looking down the page. Misaligned axes would make that
    // reading wrong in a way that is hard to notice.
    const { weight, load } = buildWeightAgainstLoadOptions({ points: loadPoints, tokens, today });
    expect(weight.xAxis).toBe(load.xAxis);
    expect(weight.grid).toEqual(load.grid);
  });

  it("keeps each panel in its own units", () => {
    const { weight, load } = buildWeightAgainstLoadOptions({ points: loadPoints, tokens, today });
    expect(seriesOf(weight)[0]?.data).toEqual([76.4, 75.5, 74.4]);
    expect(seriesOf(load)[0]?.data).toEqual([60, 75, 90]);
  });

  it("does not draw the two panels as if they were one line, in either theme", () => {
    // The first attempt used the ramp's top step, which is near-white in dark mode —
    // the same colour as the weight panel's ink above it. The middle step is the same
    // solid blue in both themes, which is the point of taking it from the middle.
    for (const theme of [colorTokens.light, colorTokens.dark]) {
      const { weight, load } = buildWeightAgainstLoadOptions({
        points: loadPoints,
        tokens: theme,
        today,
      });
      expect(seriesOf(weight)[0]?.color).toBe(theme.ink);
      expect(seriesOf(load)[0]?.color).toBe(loadColor(theme));
      expect(seriesOf(load)[0]?.color).not.toBe(theme.ink);
    }
  });

  it("gives a steady series a minimum span", () => {
    const flat = loadPoints.map((point) => ({ ...point, ctl: 70 }));
    const scale = panelScale(
      flat.map((point) => point.ctl),
      MIN_CTL_SPAN,
    );
    expect((scale?.max ?? 0) - (scale?.min ?? 0)).toBeGreaterThanOrEqual(MIN_CTL_SPAN);
  });

  it("never draws a training load below zero", () => {
    // Rounding 2..90 out to a round step puts the bottom tick at −50. A negative CTL
    // is not quiet padding, it is a quantity that cannot exist drawn as if it could.
    const fromZero = [2, 45, 90];
    expect(panelScale(fromZero, MIN_CTL_SPAN)?.min).toBeLessThan(0);
    expect(panelScale(fromZero, MIN_CTL_SPAN, 0)?.min).toBe(0);

    const load = buildWeightAgainstLoadOptions({
      points: loadPoints.map((point, i) => ({ ...point, ctl: fromZero[i] ?? 0 })),
      tokens,
      today,
    }).load;
    expect((load.yAxis as { min?: number }).min).toBe(0);
  });

  it("leaves the weight panel free to start above zero", () => {
    // Nobody weighs nothing, and an axis from 0 to 80 kg would flatten a 2 kg block
    // into a line. The floor is the load panel's business, not a rule for both.
    const { weight } = buildWeightAgainstLoadOptions({ points: loadPoints, tokens, today });
    expect((weight.yAxis as { min?: number }).min).toBeGreaterThan(50);
  });

  it("answers with both numbers from either panel", () => {
    expect(weightLoadTooltip(loadPoints, 2, today)).toBe("Sep 1 · 74.4 kg · CTL 90");
  });

  it("has no scale when there is nothing to draw", () => {
    expect(panelScale([], MIN_CTL_SPAN)).toBeNull();
  });
});

describe("run speed against weight", () => {
  it("is two percentages of the same starting week, on one axis", () => {
    // Unlike kilograms against CTL, these two really do belong together: both are
    // percentages of the same baseline, so one axis compares like with like.
    const option = buildSpeedWeightOption({ points: speedPoints, tokens, today });
    expect(Array.isArray(option.yAxis)).toBe(false);
    expect(seriesOf(option).map((s) => s.name)).toEqual(["Speed", "Weight"]);
    expect(seriesOf(option)[0]?.data).toEqual([100, 106.2, 114.4]);
    expect(seriesOf(option)[1]?.data).toEqual([100, 98.4, 95.3]);
  });

  it("always keeps 100 on the axis", () => {
    // Both series start there, so an axis that excluded it would hide the baseline
    // every value on the chart is measured against.
    const rising = speedPoints.map((p) => ({ ...p, speed_index: p.speed_index + 20 }));
    for (const points of [speedPoints, rising]) {
      const scale = indexScale(points);
      expect(scale?.min).toBeLessThanOrEqual(100);
      expect(scale?.max).toBeGreaterThanOrEqual(100);
    }
  });

  it("gives a steady year a minimum span", () => {
    const flat = speedPoints.map((p) => ({ ...p, speed_index: 100, weight_index: 100 }));
    const scale = indexScale(flat);
    expect((scale?.max ?? 0) - (scale?.min ?? 0)).toBeGreaterThanOrEqual(MIN_INDEX_SPAN);
  });

  it("says in the tooltip what the numbers are a percentage of", () => {
    // Without that clause "speed 114" reads as a speed.
    expect(speedWeightTooltip(speedPoints, 2, today)).toBe(
      "Week of Jul 20 · speed 114 · weight 95 (% of the first week)",
    );
  });

  it("gives the legend the colours the chart uses", () => {
    const colors = indexColors(tokens);
    const drawn = seriesOf(buildSpeedWeightOption({ points: speedPoints, tokens, today }));
    for (const [position, { label, index }] of INDEX_SERIES.entries()) {
      expect(colors[label]).toBe(tokens.series[index]);
      expect(drawn[position]?.color).toBe(colors[label]);
    }
  });

  it("has no scale without any weeks", () => {
    expect(indexScale([])).toBeNull();
  });
});

describe("watts per kilogram", () => {
  it("is a scatter on a time axis", () => {
    // One point is one ride under its own conditions; a line would claim a value for
    // the fortnight between two of them, and even spacing would hide that gap.
    const option = buildPowerToWeightOption({ points: powerPoints, tokens, today });
    expect(seriesOf(option)[0]?.type).toBe("scatter");
    expect((option.xAxis as { type?: string }).type).toBe("time");
  });

  it("plots each ride at its own date", () => {
    const option = buildPowerToWeightOption({ points: powerPoints, tokens, today });
    const data = seriesOf(option)[0]?.data as [number, number][];
    expect(data.map((pair) => pair[1])).toEqual([2.31, 2.64]);
    expect(data[1]?.[0]).toBeGreaterThan(data[0]?.[0] ?? 0);
  });

  it("uses the ride colour, because that is what these are", () => {
    const option = buildPowerToWeightOption({ points: powerPoints, tokens, today });
    expect(seriesOf(option)[0]?.color).toBe(tokens.kind.ride);
  });

  it("gives a steady season a minimum span", () => {
    const flat = powerPoints.map((p) => ({ ...p, watts_per_kg: 2.5 }));
    const scale = powerScale(flat);
    expect((scale?.max ?? 0) - (scale?.min ?? 0)).toBeGreaterThanOrEqual(MIN_WATTS_SPAN);
  });

  it("names the unit in the tooltip", () => {
    const point = powerPoints[1];
    expect(point && powerTooltip(point, today)).toBe("Aug 20 · 2.64 W/kg");
  });

  it("has no scale without any rides", () => {
    expect(powerScale([])).toBeNull();
  });
});
