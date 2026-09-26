// One dot per session on a time axis, with the trend drawn through them.
//
// Session-to-session decoupling and efficiency are genuinely scattered — terrain, heat,
// how hard the session was — and the runs are weeks apart, so a line joining consecutive
// points would claim a continuity that is not there. The dots are the data; the centred
// mean is the trend; the threshold is a fixed rule of thumb.
import { decimalStep, padded, snapToStep } from "@/charts/axisScale";
import { axisLabelStyle, gridLineStyle, quietAxis, tooltipStyle } from "@/charts/chrome";
import type { ChartOption } from "@/charts/echarts";
import type { ColorTokens } from "@/design/tokens";
import { fontFamily } from "@/design/typography";
import { formatDate } from "@/lib/format";
import { centredMean } from "@/lib/smoothing";
import { dayToMs, msToDay } from "@/lib/time";

/** One session's value, already reduced to the number the chart plots. */
export interface SessionPoint {
  day: string;
  value: number;
  /** The session, for the tooltip's second line: "Doha - Long Easy Run · 15.2 km". */
  detail: string;
}

/** A fixed horizontal reference, e.g. Friel's 5 % decoupling limit. */
export interface TrendThreshold {
  value: number;
  /** Always shown next to the line: a status colour never travels without its label. */
  label: string;
}

export interface SessionTrendInput {
  points: readonly SessionPoint[];
  tokens: ColorTokens;
  /** The plotted value as the tooltip reads it, with its unit: "+12.5%". */
  formatValue: (value: number) => string;
  /** A y tick. Only the top one carries the unit, so it is read once. */
  formatTick: (value: number, isTopTick: boolean) => string;
  threshold?: TrendThreshold;
  /** Sessions the trend line averages over. */
  meanWindow?: number;
  today?: Date;
}

/** Long enough to outlast a hot week, short enough to still bend within a season. */
export const TREND_WINDOW_SESSIONS = 10;

// Four rather than the stream charts' three: decoupling spans roughly -35 % to +30 %,
// and three intervals over that only ever lands on a step of 50, which squashes every
// session into the middle third of the chart.
const MAX_Y_INTERVALS = 4;
const Y_PADDING = 0.05;
const DOT_SIZE = 6;
const DOT_OPACITY = 0.55;
const TREND_WIDTH = 2;

/** Y bounds on round values, wide enough to hold every point and the threshold. */
export function sessionTrendYScale(
  values: readonly number[],
  threshold?: number,
): { min: number; max: number; step: number } | null {
  const all = threshold === undefined ? values : [...values, threshold];
  if (all.length === 0) return null;

  const spread = padded([Math.min(...all), Math.max(...all)], Y_PADDING);
  const step = decimalStep(spread[1] - spread[0], MAX_Y_INTERVALS);
  const [min, max] = snapToStep(spread, step);
  return { min, max, step };
}

/** "Sep 22 · +12.5%" over the session that scored it. */
export function sessionTrendTooltip(
  point: SessionPoint,
  formatValue: (value: number) => string,
  today?: Date,
): string {
  const head = `${formatDate(point.day, today)} · ${formatValue(point.value)}`;
  return point.detail === "" ? head : `${head}<br>${point.detail}`;
}

export function buildSessionTrendOption({
  points,
  tokens,
  formatValue,
  formatTick,
  threshold,
  meanWindow = TREND_WINDOW_SESSIONS,
  today,
}: SessionTrendInput): ChartOption {
  const values = points.map((point) => point.value);
  const scale = sessionTrendYScale(values, threshold?.value);
  const trend = centredMean(values, meanWindow);
  const labelStyle = axisLabelStyle(tokens);

  return {
    animation: false,
    textStyle: { fontFamily },
    // The right margin is the threshold label's: inside the plot it sat on top of the
    // sessions it is there to judge.
    grid: { left: 44, right: threshold ? 40 : 16, top: 12, bottom: 24 },
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
      axisLabel: {
        ...labelStyle,
        formatter: (value: number) => formatTick(value, value === scale?.max),
      },
    },
    tooltip: {
      // Per point, not per axis: the runs are weeks apart, so a vertical crosshair
      // would usually sit between two of them with nothing to report.
      trigger: "item",
      ...tooltipStyle(tokens),
      formatter: (params) => {
        const one = Array.isArray(params) ? params[0] : params;
        const point = one === undefined ? undefined : points[one.dataIndex];
        return point === undefined ? "" : sessionTrendTooltip(point, formatValue, today);
      },
    },
    series: [
      {
        type: "scatter",
        name: "Sessions",
        data: points.map((point) => [dayToMs(point.day), point.value]),
        symbolSize: DOT_SIZE,
        itemStyle: { color: tokens.kind.run, opacity: DOT_OPACITY },
        // Every point here is a run, and run is orange everywhere in the app.
        emphasis: { itemStyle: { opacity: 1 } },
      },
      {
        type: "line",
        name: "Trend",
        data: points.map((point, i) => [dayToMs(point.day), trend[i] ?? null]),
        color: tokens.ink,
        lineStyle: { color: tokens.ink, width: TREND_WIDTH },
        showSymbol: false,
        // The dots answer "which session"; the trend is only ever read as a shape.
        silent: true,
        markLine: threshold && {
          silent: true,
          symbol: "none",
          data: [{ yAxis: threshold.value }],
          lineStyle: { color: tokens.status.warning, width: 1.5, type: "dashed" },
          label: {
            ...labelStyle,
            color: tokens.status.warning,
            position: "end",
            formatter: threshold.label,
          },
        },
      },
    ],
  };
}
