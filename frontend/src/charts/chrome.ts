// Chart chrome every chart shares: quiet axes, hairline gridlines, one tooltip style.
import type { ColorTokens } from "@/design/tokens";
import { fontFamily, fontSize } from "@/design/typography";

export function axisLabelStyle(tokens: ColorTokens) {
  return { color: tokens.inkMuted, fontSize: fontSize.caption, fontFamily };
}

export function gridLineStyle(tokens: ColorTokens) {
  return { show: true, lineStyle: { color: tokens.gridline, width: 1 } };
}

/**
 * A chart's plot area. Only the side gutters vary between charts, because only they
 * depend on how wide that chart's y-axis labels run; the space above the top gridline
 * and below the x-axis labels is chrome, and is the same everywhere.
 */
export function chartGrid(gutters: { left: number; right: number }) {
  return { ...gutters, top: 12, bottom: 24 } as const;
}

/** Axis line, ticks and vertical gridlines all off: the data and the labels carry it. */
export const quietAxis = {
  axisLine: { show: false },
  axisTick: { show: false },
} as const;

export function tooltipStyle(tokens: ColorTokens) {
  return {
    showDelay: 0,
    transitionDuration: 0,
    confine: true,
    backgroundColor: tokens.surface,
    borderColor: tokens.border,
    borderWidth: 1,
    padding: [4, 8],
    textStyle: { color: tokens.ink, fontSize: fontSize.body, fontFamily },
    extraCssText: "font-variant-numeric: tabular-nums; box-shadow: none; border-radius: 6px;",
  };
}

/** Bars get rounded tops only, so they still sit flat on the baseline. */
export const BAR_TOP_RADIUS: [number, number, number, number] = [3, 3, 0, 0];

/** The corner radius at the two ends of a single horizontal bar. */
export const BAR_END_RADIUS = 3;

/** Hovering a bar chart washes the whole category behind the bar. */
export function barHoverPointer(tokens: ColorTokens) {
  return {
    type: "shadow",
    shadowStyle: { color: tokens.surfaceMuted, opacity: 0.6 },
  } as const;
}
