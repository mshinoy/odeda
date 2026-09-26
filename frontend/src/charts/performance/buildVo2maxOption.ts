// Garmin's running VO2max estimate. Unlike decoupling and efficiency this is a daily
// value, not a per-session one, so a continuous line is honest: it is the estimate
// Garmin held on that day, and it holds between runs.
import { decimalStep, padded, snapToStep } from "@/charts/axisScale";
import { axisLabelStyle, gridLineStyle, quietAxis, tooltipStyle } from "@/charts/chrome";
import type { ChartOption } from "@/charts/echarts";
import type { components } from "@/api/schema";
import type { ColorTokens } from "@/design/tokens";
import { fontFamily } from "@/design/typography";
import { formatDate, formatDecimal, formatVo2max } from "@/lib/format";
import { dayToMs, msToDay } from "@/lib/time";

type Vo2maxPoint = components["schemas"]["Vo2maxPoint"];

export interface Vo2maxChartInput {
  series: readonly Vo2maxPoint[];
  tokens: ColorTokens;
  today?: Date;
}

const MAX_Y_INTERVALS = 3;
const Y_PADDING = 0.1;
const LINE_WIDTH = 2;

/** Y bounds on round values. A flat year should read flat, so the range is the data's. */
export function vo2maxYScale(
  series: readonly Vo2maxPoint[],
): { min: number; max: number; step: number } | null {
  if (series.length === 0) return null;
  const values = series.map((point) => point.vo2max_run);

  const spread = padded([Math.min(...values), Math.max(...values)], Y_PADDING);
  const step = decimalStep(spread[1] - spread[0], MAX_Y_INTERVALS);
  const [min, max] = snapToStep(spread, step);
  return { min, max, step };
}

/** "Sep 24 · 46.0 ml/kg/min". */
export function vo2maxTooltip(point: Vo2maxPoint, today?: Date): string {
  return `${formatDate(point.day, today)} · ${formatVo2max(point.vo2max_run)}`;
}

export function buildVo2maxOption({ series, tokens, today }: Vo2maxChartInput): ChartOption {
  const scale = vo2maxYScale(series);
  const labelStyle = axisLabelStyle(tokens);

  return {
    animation: false,
    textStyle: { fontFamily },
    grid: { left: 44, right: 16, top: 12, bottom: 24 },
    xAxis: {
      type: "time",
      ...quietAxis,
      splitLine: { show: false },
      axisLabel: {
        ...labelStyle,
        hideOverlap: true,
        formatter: (value: number) => formatDate(msToDay(value), today),
      },
    },
    yAxis: {
      type: "value",
      ...quietAxis,
      min: scale?.min,
      max: scale?.max,
      interval: scale?.step,
      splitLine: gridLineStyle(tokens),
      // Bare ticks; the tooltip carries "ml/kg/min", which no axis tick has room for.
      axisLabel: { ...labelStyle, formatter: (value: number) => formatDecimal(value, 0) },
    },
    tooltip: {
      trigger: "axis",
      ...tooltipStyle(tokens),
      axisPointer: { type: "line", lineStyle: { color: tokens.cursor, width: 1 } },
      formatter: (params) => {
        const one = Array.isArray(params) ? params[0] : params;
        const point = one === undefined ? undefined : series[one.dataIndex];
        return point === undefined ? "" : vo2maxTooltip(point, today);
      },
    },
    series: [
      {
        type: "line",
        name: "VO₂max",
        data: series.map((point) => [dayToMs(point.day), point.vo2max_run]),
        color: tokens.ink,
        lineStyle: { color: tokens.ink, width: LINE_WIDTH },
        emphasis: { disabled: true },
        showSymbol: false,
      },
    ],
  };
}
