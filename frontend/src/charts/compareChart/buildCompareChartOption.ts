// The ECharts option for one metric across several activities, on one shared x-axis.
// Pure, like every other chart builder here. The single-activity chart's scales and
// formatting are reused, so a compared pace axis reads exactly as its own page's does.
import type { ActivityStreams } from "@/api/adapters";
import { decimalStep, MINUTES_STEPS, stepFrom } from "@/charts/axisScale";
import type { ChartOption } from "@/charts/echarts";
import {
  formatPlotValue,
  formatYTick,
  LINE_WIDTH,
  STREAM_CHART_GRID,
  streamYInverted,
  streamYScale,
  streamYValues,
} from "@/charts/streamChart/buildStreamChartOption";
import {
  formatX,
  hasDistance,
  largest,
  MAX_X_INTERVALS,
  streamXValues,
  type StreamXUnit,
} from "@/charts/streamChart/streamXAxis";
import { evenGrid, resampleOnto } from "@/charts/compareChart/resample";
import type { ColorTokens } from "@/design/tokens";
import { fontFamily, fontSize } from "@/design/typography";
import type { ActivityKind } from "@/lib/activityKind";
import { MISSING } from "@/lib/format";
import type { MetricDefinition } from "@/lib/metrics";

/** One activity on the compare charts. */
export interface CompareSeries {
  id: string;
  /** Shown in the tooltip, one line each. */
  label: string;
  color: string;
  streams: ActivityStreams;
  kind: ActivityKind;
}

export interface CompareXAxis {
  unit: StreamXUnit;
  /** The x values every series is plotted at, so a crosshair names all of them. */
  grid: number[];
  max: number;
  step: number;
}

/**
 * The axis every compared activity is plotted against: distance when all of them
 * recorded it, elapsed time otherwise. One unit for all, because the whole point is
 * that the lines lie on top of each other.
 */
export function compareXAxis(series: readonly CompareSeries[]): CompareXAxis {
  const unit: StreamXUnit = series.every((s) => hasDistance(s.streams)) ? "km" : "min";
  const max = largest(series.flatMap((s) => streamXValues(s.streams, unit)));
  const step =
    unit === "km"
      ? decimalStep(max, MAX_X_INTERVALS)
      : stepFrom(MINUTES_STEPS, max, MAX_X_INTERVALS);
  return { unit, grid: evenGrid(max), max, step };
}

/** One activity's values read at every point of the shared grid. */
export function compareSeriesData(
  item: CompareSeries,
  metric: MetricDefinition,
  kind: ActivityKind,
  axis: CompareXAxis,
): (number | null)[] {
  return resampleOnto(
    streamXValues(item.streams, axis.unit),
    streamYValues(metric, item.streams, kind),
    axis.grid,
  );
}

/** Every compared activity's values for this metric, for one shared y-scale. */
export function compareYValues(
  series: readonly CompareSeries[],
  metric: MetricDefinition,
  kind: ActivityKind,
): (number | null)[] {
  return series.flatMap((s) => streamYValues(metric, s.streams, kind));
}

/**
 * The sport the axis reads in. Comparing a run with a ride is allowed but unusual, and
 * one axis can only carry one unit, so the first activity's sport decides it.
 */
export function compareKind(series: readonly CompareSeries[]): ActivityKind {
  return series[0]?.kind ?? "other";
}

interface CompareChartInput {
  series: readonly CompareSeries[];
  metric: MetricDefinition;
  tokens: ColorTokens;
  /** Stacked charts label the x-axis once, under the last chart. */
  showXAxisLabels?: boolean;
}

export function buildCompareChartOption({
  series,
  metric,
  tokens,
  showXAxisLabels = true,
}: CompareChartInput): ChartOption {
  const xAxis = compareXAxis(series);
  const kind = compareKind(series);
  const yScale = streamYScale(metric, compareYValues(series, metric, kind), kind);
  const inverted = streamYInverted(metric, kind);

  return {
    animation: false,
    textStyle: { fontFamily },
    grid: { ...STREAM_CHART_GRID },
    xAxis: {
      type: "value",
      min: 0,
      max: xAxis.max,
      interval: xAxis.step,
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { show: false },
      axisLabel: {
        show: showXAxisLabels,
        color: tokens.inkMuted,
        fontSize: fontSize.caption,
        showMinLabel: false,
        showMaxLabel: false,
        formatter: (value: number) => formatX(xAxis.unit, value),
      },
    },
    yAxis: {
      type: "value",
      inverse: inverted,
      min: yScale?.min,
      max: yScale?.max,
      interval: yScale?.step,
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { show: true, lineStyle: { color: tokens.gridline, width: 1 } },
      axisLabel: {
        color: tokens.inkMuted,
        fontSize: fontSize.caption,
        formatter: (value: number) =>
          formatYTick(metric, value, kind, isTop(value, yScale, inverted)),
      },
    },
    tooltip: {
      trigger: "axis",
      showDelay: 0,
      transitionDuration: 0,
      confine: true,
      backgroundColor: tokens.surface,
      borderColor: tokens.border,
      borderWidth: 1,
      padding: [4, 8],
      textStyle: { color: tokens.ink, fontSize: fontSize.body, fontFamily },
      extraCssText: "font-variant-numeric: tabular-nums; box-shadow: none; border-radius: 6px;",
      axisPointer: {
        type: "line",
        snap: true,
        animation: false,
        label: { show: false },
        lineStyle: { color: tokens.cursor, width: 1, type: "solid" },
      },
      formatter: (params) => compareTooltip(params, metric, kind),
    },
    series: series.map((item) => ({
      type: "line" as const,
      name: item.label,
      data: compareSeriesData(item, metric, kind, xAxis).map((y, i) => [xAxis.grid[i] ?? 0, y]),
      color: item.color,
      lineStyle: { color: item.color, width: LINE_WIDTH },
      emphasis: { lineStyle: { color: item.color, width: LINE_WIDTH } },
      showSymbol: false,
      connectNulls: false,
      // No downsampling: the grid is already small, and dropping points per series
      // would put them back on x values only that series has, which is what the grid
      // exists to avoid.
      animation: false,
    })),
  };
}

/** One line per compared activity: its name and its value at the crosshair. */
export function compareTooltip(
  params: unknown,
  metric: MetricDefinition,
  kind: ActivityKind,
): string {
  const points = Array.isArray(params) ? params : [params];
  const lines = points.map((point) => {
    const name = seriesName(point);
    const value = pointValue(point);
    const text = value === null ? MISSING : formatPlotValue(metric, value, kind);
    return `${name} ${text}`;
  });
  return lines.join("<br>");
}

function seriesName(point: unknown): string {
  if (typeof point !== "object" || point === null || !("seriesName" in point)) return "";
  return typeof point.seriesName === "string" ? point.seriesName : "";
}

function pointValue(point: unknown): number | null {
  if (typeof point !== "object" || point === null || !("value" in point)) return null;
  const value: unknown = point.value;
  if (!Array.isArray(value)) return null;
  const y: unknown = value[1];
  return typeof y === "number" ? y : null;
}

/** Whether a tick is the one drawn at the top of the plot (the min on an inverted axis). */
function isTop(
  value: number,
  scale: { min: number; max: number; step: number } | null,
  inverted: boolean,
): boolean {
  if (scale === null) return false;
  const top = inverted ? scale.min : scale.max;
  return Math.abs(value - top) < scale.step / 2;
}
