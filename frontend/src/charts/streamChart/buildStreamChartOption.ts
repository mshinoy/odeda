// The ECharts option for one metric of one activity, as a pure function of the data and
// the theme's tokens. No legend: each chart plots one metric under its own label.
import type { TooltipComponentPositionCallback } from "echarts";
import type { ActivityStreams } from "@/api/adapters";
import {
  decimalStep,
  padded,
  quantileRange,
  SECONDS_STEPS,
  snapToStep,
  stepFrom,
  withMinSpan,
} from "@/charts/axisScale";
import type { ChartOption } from "@/charts/echarts";
import { streamXAxis, type StreamXAxis } from "@/charts/streamChart/streamXAxis";
import type { ColorTokens } from "@/design/tokens";
import { kindColor, metricColor } from "@/design/scales";
import type { ActivityKind } from "@/lib/activityKind";
import { formatPace, MISSING } from "@/lib/format";
import type { MetricDefinition, MetricKey } from "@/lib/metrics";

export interface StreamChartInput {
  streams: ActivityStreams;
  metric: MetricDefinition;
  kind: ActivityKind;
  tokens: ColorTokens;
  /** Stacked charts label the x-axis once, under the last chart. Default true. */
  showXAxisLabels?: boolean;
}

/** Layout shared by every stream chart, so stacked charts' plot areas line up exactly. */
export const STREAM_CHART_GRID = { left: 64, right: 12, top: 10, bottom: 24 } as const;

export const LINE_WIDTH = 1.5;
const AREA_OPACITY = 0.12;
const LABEL_FONT_SIZE = 12;
const FONT_FAMILY = '"Geist Variable", sans-serif';
const MAX_Y_INTERVALS = 3;
// Fraction of the data's span added above and below the line.
const Y_PADDING = 0.05;
const TOOLTIP_GAP_PX = 10;

/**
 * The share of samples the y-axis ignores at each end. Pace and grade have spikes (a
 * stop is a near-infinite s/km); HR and elevation are shown to their true extremes.
 */
const Y_QUANTILES: Record<MetricKey, [number, number]> = {
  pace: [0.02, 0.98],
  hr: [0, 1],
  elevation: [0, 1],
  gradient: [0.02, 0.98],
};

/** The smallest y span, so a flat course or a steady effort does not fill the chart with noise. */
const Y_MIN_SPAN: Record<MetricKey, number> = {
  pace: 30,
  hr: 10,
  elevation: 10,
  gradient: 2,
};

/**
 * The line colour rule: pace and elevation take the activity kind's colour (the same one
 * as the route and the badge), HR takes zone 4 of the HR ramp (the HR hue family), and
 * grade the middle of the metric ramp.
 */
export function streamLineColor(
  metric: MetricKey,
  kind: ActivityKind,
  tokens: ColorTokens,
): string {
  switch (metric) {
    case "pace":
    case "elevation":
      return kindColor(tokens, kind);
    case "hr":
      return tokens.hrZones[3];
    case "gradient":
      return metricColor(tokens, 0.5);
  }
}

/** A plotted value as text. Pace plots seconds per km; the rest plot their scale value. */
export function formatPlotValue(
  metric: MetricDefinition,
  value: number,
  kind: ActivityKind,
): string {
  if (metric.key === "pace") return formatPace(value);
  return metric.formatScaleValue(value, kind);
}

/** The tooltip's one line: "5:12 /km · 3.4 km". A missing value shows as MISSING. */
export function formatTooltipLine(
  metric: MetricDefinition,
  kind: ActivityKind,
  xAxis: StreamXAxis,
  x: number,
  y: number | null,
): string {
  const valueText = y === null ? MISSING : formatPlotValue(metric, y, kind);
  return `${valueText} · ${xAxis.format(x)}`;
}

/** Y bounds and tick step on round values, or null when the metric has no values to plot. */
export function streamYScale(
  metric: MetricDefinition,
  values: readonly (number | null)[],
): { min: number; max: number; step: number } | null {
  const [lowerQuantile, upperQuantile] = Y_QUANTILES[metric.key];
  const range = quantileRange(values, lowerQuantile, upperQuantile);
  if (range === null) return null;

  const spread = padded(withMinSpan(range, Y_MIN_SPAN[metric.key]), Y_PADDING);
  const span = spread[1] - spread[0];
  const step =
    metric.key === "pace"
      ? stepFrom(SECONDS_STEPS, span, MAX_Y_INTERVALS)
      : decimalStep(span, MAX_Y_INTERVALS);
  const [min, max] = snapToStep(spread, step);
  return { min, max, step };
}

export function buildStreamChartOption({
  streams,
  metric,
  kind,
  tokens,
  showXAxisLabels = true,
}: StreamChartInput): ChartOption {
  const xAxis = streamXAxis(streams);
  const yValues = metric.plotValues(streams);
  const yScale = streamYScale(metric, yValues);
  const color = streamLineColor(metric.key, kind, tokens);
  const data = xAxis.values.map((x, i) => [x, yValues[i] ?? null]);
  const areaStyle =
    metric.key === "elevation"
      ? { color, opacity: AREA_OPACITY, origin: "start" as const }
      : undefined;

  return {
    animation: false,
    textStyle: { fontFamily: FONT_FAMILY },
    grid: { ...STREAM_CHART_GRID },
    xAxis: {
      type: "value",
      min: xAxis.min,
      max: xAxis.max,
      interval: xAxis.step,
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { show: false },
      axisLabel: {
        show: showXAxisLabels,
        color: tokens.inkMuted,
        fontSize: LABEL_FONT_SIZE,
        showMinLabel: false,
        showMaxLabel: false,
        formatter: (value: number) => xAxis.format(value),
      },
    },
    yAxis: {
      type: "value",
      inverse: metric.invertAxis,
      min: yScale?.min,
      max: yScale?.max,
      interval: yScale?.step,
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { show: true, lineStyle: { color: tokens.gridline, width: 1 } },
      axisLabel: {
        color: tokens.inkMuted,
        fontSize: LABEL_FONT_SIZE,
        formatter: (value: number) => formatPlotValue(metric, value, kind),
      },
    },
    tooltip: {
      trigger: "axis",
      showDelay: 0,
      transitionDuration: 0,
      confine: true,
      position: tooltipPosition,
      backgroundColor: tokens.surface,
      borderColor: tokens.border,
      borderWidth: 1,
      padding: [4, 8],
      textStyle: { color: tokens.ink, fontSize: LABEL_FONT_SIZE, fontFamily: FONT_FAMILY },
      extraCssText: "font-variant-numeric: tabular-nums; box-shadow: none; border-radius: 6px;",
      axisPointer: {
        type: "line",
        snap: true,
        animation: false,
        label: { show: false },
        lineStyle: { color: tokens.cursor, width: 1, type: "solid" },
      },
      formatter: (params) => {
        const point = firstPoint(params);
        if (point === null) return "";
        return formatTooltipLine(metric, kind, xAxis, point.x, point.y);
      },
    },
    series: [
      {
        type: "line",
        data,
        color,
        lineStyle: { color, width: LINE_WIDTH },
        areaStyle,
        // Hovering highlights the series; pin its look so only the crosshair moves.
        emphasis: { lineStyle: { color, width: LINE_WIDTH }, areaStyle, itemStyle: { color } },
        showSymbol: false,
        connectNulls: false,
        sampling: "lttb",
        animation: false,
      },
    ],
  };
}

/** Next to the crosshair at the top of the chart, flipping left near the right edge. */
const tooltipPosition: TooltipComponentPositionCallback = (point, _params, _el, _rect, size) => {
  const [x] = point;
  const [tipWidth] = size.contentSize;
  const [viewWidth] = size.viewSize;
  const fitsRight = x + TOOLTIP_GAP_PX + tipWidth <= viewWidth;
  const left = fitsRight ? x + TOOLTIP_GAP_PX : x - TOOLTIP_GAP_PX - tipWidth;
  return [left, 0];
};

/** The [x, y] of the first series' point in an axis tooltip's params. */
function firstPoint(params: unknown): { x: number; y: number | null } | null {
  const first: unknown = Array.isArray(params) ? params[0] : params;
  if (typeof first !== "object" || first === null || !("value" in first)) return null;

  const value: unknown = first.value;
  if (!Array.isArray(value)) return null;
  const [x, y]: unknown[] = value;
  if (typeof x !== "number") return null;
  return { x, y: typeof y === "number" ? y : null };
}
