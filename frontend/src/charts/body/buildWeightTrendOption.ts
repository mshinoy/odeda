// The weight trend, with the mornings it was computed from scattered faintly behind it.
//
// The ordering is the argument. A scale reading carries ~0.6 kg of hydration and a
// block's real change is a few kilograms over months, so the trend is the series and
// the readings are evidence for it. They are drawn as unconnected dots rather than as a
// line: a line through them would look like a second, equally valid, answer.
import { decimalStep, padded, quantileRange, snapToStep, withMinSpan } from "@/charts/axisScale";
import { axisLabelStyle, gridLineStyle, quietAxis, tooltipStyle } from "@/charts/chrome";
import type { ChartOption } from "@/charts/echarts";
import { dayAxis, HEALTH_CHART_GRID } from "@/charts/health/dayAxis";
import type { BodySeries } from "@/api/queries/useBody";
import type { ColorTokens } from "@/design/tokens";
import { fontFamily, fontSize } from "@/design/typography";
import { formatDate, formatDecimal, formatWithUnit, MISSING } from "@/lib/format";

export interface WeightTrendInput {
  series: BodySeries;
  tokens: ColorTokens;
  today?: Date;
}

export const TREND_LABEL = "Trend";

const MAX_Y_INTERVALS = 3;
const Y_PADDING = 0.08;

/** The smallest y span, in kg. Under this a steady month fills the chart with noise. */
export const MIN_WEIGHT_SPAN_KG = 2;

/** Faint, small and unconnected: evidence for the line, not a second line. */
export const READING_SYMBOL_SIZE = 3;
export const READING_OPACITY = 0.45;

export interface WeightScale {
  min: number;
  max: number;
  step: number;
}

/**
 * Y bounds and a tick step on round values, or null when nothing was weighed.
 *
 * Scaled to the raw readings rather than to the trend, because the readings are what
 * is drawn furthest from the middle — bounding to the trend alone would clip the dots
 * the chart exists to show alongside it.
 */
export function weightScale(series: BodySeries): WeightScale | null {
  const range = quantileRange(series.weight_kg, 0, 1);
  if (range === null) return null;
  const spread = padded(withMinSpan(range, MIN_WEIGHT_SPAN_KG), Y_PADDING);
  const step = decimalStep(spread[1] - spread[0], MAX_Y_INTERVALS);
  const [min, max] = snapToStep(spread, step);
  return { min, max, step };
}

/** "Sep 23 · 76.4 kg · trend 76.9". The reading second, because it is the lesser fact. */
export function weightTooltip(series: BodySeries, index: number, today?: Date): string {
  const day = series.days[index];
  if (day === undefined) return "";
  const reading = series.weight_kg[index] ?? null;
  const trend = series.trend_kg[index] ?? null;
  return [
    formatDate(day, today),
    reading === null ? MISSING : formatWithUnit(reading, "kg", 1),
    `trend ${formatDecimal(trend, 1)}`,
  ].join(" · ");
}

export function buildWeightTrendOption({ series, tokens, today }: WeightTrendInput): ChartOption {
  const scale = weightScale(series);

  return {
    animation: false,
    textStyle: { fontFamily },
    grid: HEALTH_CHART_GRID,
    xAxis: dayAxis(series.days, tokens, today),
    yAxis: {
      type: "value",
      min: scale?.min,
      max: scale?.max,
      interval: scale?.step,
      ...quietAxis,
      splitLine: gridLineStyle(tokens),
      axisLabel: {
        ...axisLabelStyle(tokens),
        formatter: (value: number) =>
          scale !== null && value === scale.max
            ? formatWithUnit(value, "kg", 1)
            : formatDecimal(value, 1),
      },
    },
    tooltip: {
      trigger: "axis",
      ...tooltipStyle(tokens),
      axisPointer: { type: "line", lineStyle: { color: tokens.cursor, width: 1 } },
      formatter: (params) => {
        const first = Array.isArray(params) ? params[0] : params;
        return first ? weightTooltip(series, first.dataIndex, today) : "";
      },
    },
    series: [
      {
        type: "scatter",
        name: "Weigh-in",
        data: [...series.weight_kg],
        color: tokens.inkMuted,
        symbolSize: READING_SYMBOL_SIZE,
        itemStyle: { color: tokens.inkMuted, opacity: READING_OPACITY },
        emphasis: { disabled: true },
      },
      {
        type: "line",
        name: TREND_LABEL,
        data: [...series.trend_kg],
        color: tokens.ink,
        lineStyle: { color: tokens.ink, width: 2 },
        emphasis: { disabled: true },
        showSymbol: false,
        // The trend is null only before the first weigh-in ever, so joining across
        // would draw a line over a period with no scale in the house at all.
        connectNulls: false,
        endLabel: {
          show: true,
          formatter: TREND_LABEL,
          color: tokens.ink,
          fontFamily,
          fontSize: fontSize.caption,
        },
      },
    ],
  };
}
