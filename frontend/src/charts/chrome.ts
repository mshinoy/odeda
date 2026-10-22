// Chart chrome every chart shares: quiet axes, hairline gridlines, one tooltip style.
import type { DataZoomComponentOption } from "echarts/components";
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

/** Vertical room the zoom slider needs under the x-axis labels. */
export const ZOOM_GUTTER = 28;

/**
 * Drag-to-zoom for a chart whose window may be years long.
 *
 * Scroll is deliberately left out: these charts sit in a scrolling page, and a wheel
 * that zoomed the chart instead of moving the page is the worst kind of surprise.
 * Dragging inside the plot, or the slider under it, both work.
 */
export function zoomControls(tokens: ColorTokens): DataZoomComponentOption[] {
  return [
    { type: "inside", zoomOnMouseWheel: false, moveOnMouseWheel: false, throttle: 50 },
    {
      type: "slider",
      height: 14,
      bottom: 4,
      borderColor: "transparent",
      // The track has to be visible or the control is undiscoverable: a transparent
      // one on a pale page is a feature nobody finds.
      backgroundColor: tokens.surfaceMuted,
      fillerColor: tokens.gridline,
      handleStyle: { color: tokens.inkMuted, borderColor: tokens.inkMuted },
      moveHandleStyle: { color: tokens.inkMuted },
      moveHandleSize: 4,
      // The dates are already on the axis above; repeating them in the handle labels
      // is the same fact twice in half the space.
      showDetail: false,
      showDataShadow: false,
      textStyle: { color: tokens.inkMuted, fontSize: fontSize.caption, fontFamily },
    },
  ];
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
