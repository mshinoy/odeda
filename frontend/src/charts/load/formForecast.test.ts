import { describe, expect, it } from "vitest";
import type { components } from "@/api/schema";
import {
  buildFormForecastOption,
  FRESH_WINDOW,
  formForecastTooltip,
  weeklyPoints,
} from "@/charts/load/buildFormForecastOption";
import { colorTokens } from "@/design/tokens";

type ForecastDay = components["schemas"]["ForecastDay"];

const tokens = colorTokens.light;
const today = new Date(2026, 11, 1);

const day = (d: string, tsb: number, followed: number | null): ForecastDay => ({
  day: d,
  ctl: 50,
  atl: 50 - tsb,
  tsb,
  ctl_followed: followed === null ? null : 50,
  atl_followed: followed === null ? null : 50 - followed,
  tsb_followed: followed,
});

const curve = [day("2026-12-01", -5, -5), day("2026-12-02", 0, -2), day("2026-12-03", 10, 6)];

function seriesOf(option: ReturnType<typeof buildFormForecastOption>) {
  return Array.isArray(option.series) ? option.series : [];
}

describe("buildFormForecastOption", () => {
  it("draws what you are likely to have, and the prescription dashed beside it", () => {
    const series = seriesOf(buildFormForecastOption({ curve, tokens, today }));
    expect(series).toHaveLength(2);
    // Sampled weekly back from race morning: with three days that is the first and the last.
    expect(series[0]?.data).toEqual([-5, 6]);
    expect(series[1]?.data).toEqual([-5, 10]);
  });

  it("draws one line when there is no adherence to follow", () => {
    const plain = curve.map((d) => day(d.day, d.tsb, null));
    expect(seriesOf(buildFormForecastOption({ curve: plain, tokens, today }))).toHaveLength(1);
  });

  it("shades the window a taper aims for", () => {
    const [first] = seriesOf(buildFormForecastOption({ curve, tokens, today }));
    const area = (first as { markArea?: { data: unknown } }).markArea;
    expect(area?.data).toEqual([[{ yAxis: FRESH_WINDOW.low }, { yAxis: FRESH_WINDOW.high }]]);
  });
});

describe("formForecastTooltip", () => {
  it("gives the likely form and the prescribed one", () => {
    const last = curve.at(-1);
    if (!last) throw new Error("fixture has no days");
    expect(formForecastTooltip(last, today)).toBe("Dec 3 · Form +6.0 · as planned +10.0");
  });
});

describe("weeklyPoints", () => {
  it("takes today, then a point a week counting back from race morning", () => {
    const days = Array.from({ length: 20 }, (_, i) =>
      day(`2026-12-${String(i + 1).padStart(2, "0")}`, i, null),
    );
    expect(weeklyPoints(days).map((d) => d.tsb)).toEqual([0, 5, 12, 19]);
  });
});
