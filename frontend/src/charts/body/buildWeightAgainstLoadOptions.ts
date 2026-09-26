// Bodyweight through a training block, against the block.
//
// Two panels, not two lines on one chart. Kilograms and CTL are not the same quantity
// and their ranges are nothing alike — a build takes CTL from 60 to 90 while the scale
// moves 2 kg — so any single axis holding both either flattens the weight into a
// straight line or scales one of them against a second axis that is not drawn. Twin
// axes are what people reach for here and they are not allowed (Rules), for the good
// reason that an undrawn scale invites the reader to compare two shapes that were
// stretched by different amounts.
//
// Stacked panels over one shared day axis say the same thing honestly: each series
// keeps its own units, and reading them together is a matter of looking down the page,
// which is what "overlaid on CTL" was asking for.
import { decimalStep, padded, quantileRange, snapToStep, withMinSpan } from "@/charts/axisScale";
import { axisLabelStyle, chartGrid, gridLineStyle, quietAxis, tooltipStyle } from "@/charts/chrome";
import type { ChartOption } from "@/charts/echarts";
import type { WeightLoadPoint } from "@/api/queries/useBody";
import type { ColorTokens } from "@/design/tokens";
import { fontFamily } from "@/design/typography";
import { formatDate, formatDecimal, formatWithUnit } from "@/lib/format";

export interface WeightAgainstLoadInput {
  points: readonly WeightLoadPoint[];
  tokens: ColorTokens;
  today?: Date;
}

/** Both panels share these gutters, or the two x axes would not line up under each other. */
const PANEL_GRID = chartGrid({ left: 44, right: 16 });

const MAX_Y_INTERVALS = 3;
const Y_PADDING = 0.08;
const X_LABELS = 4;

export const MIN_WEIGHT_SPAN_KG = 2;
export const MIN_CTL_SPAN = 10;

/** The load panel's colour: the magnitude ramp's middle step, which reads in both themes. */
export function loadColor(tokens: ColorTokens): string {
  return tokens.metricRamp[Math.floor(tokens.metricRamp.length / 2)] ?? tokens.ink;
}

export interface Scale {
  min: number;
  max: number;
  step: number;
}

/**
 * Y bounds on round values.
 *
 * `floor` is not cosmetic. Rounding a range of 2..90 out to a round step lands the
 * bottom tick at −50, and a training load below zero is not a quiet bit of padding —
 * it is a quantity that cannot exist, drawn on an axis as if it could.
 */
export function panelScale(
  values: readonly number[],
  minSpan: number,
  floor?: number,
): Scale | null {
  const range = quantileRange(values, 0, 1);
  if (range === null) return null;
  const spread = padded(withMinSpan(range, minSpan), Y_PADDING);
  const step = decimalStep(spread[1] - spread[0], MAX_Y_INTERVALS);
  const [min, max] = snapToStep(spread, step);
  return { min: floor === undefined ? min : Math.max(min, floor), max, step };
}

/** "Sep 23 · 74.4 kg · CTL 84.5" — both panels answer with both numbers. */
export function weightLoadTooltip(
  points: readonly WeightLoadPoint[],
  index: number,
  today?: Date,
): string {
  const point = points[index];
  if (point === undefined) return "";
  return [
    formatDate(point.day, today),
    formatWithUnit(point.trend_kg, "kg", 1),
    `CTL ${formatDecimal(point.ctl, 0)}`,
  ].join(" · ");
}

function sharedXAxis(points: readonly WeightLoadPoint[], tokens: ColorTokens, today?: Date) {
  return {
    type: "category" as const,
    data: points.map((point) => point.day),
    ...quietAxis,
    splitLine: { show: false },
    axisLabel: {
      ...axisLabelStyle(tokens),
      interval: Math.max(Math.floor(points.length / X_LABELS) - 1, 0),
      formatter: (value: string) => formatDate(value, today),
    },
  };
}

interface PanelInput {
  points: readonly WeightLoadPoint[];
  /** Built once and handed to both panels, so they cannot drift out of alignment. */
  xAxis: ReturnType<typeof sharedXAxis>;
  values: readonly number[];
  scale: Scale | null;
  color: string;
  digits: number;
  /** "" for a bare number: CTL is an index and has no unit to write on a tick. */
  unit: string;
  tokens: ColorTokens;
  today?: Date;
}

function panel({
  points,
  xAxis,
  values,
  scale,
  color,
  digits,
  unit,
  tokens,
  today,
}: PanelInput): ChartOption {
  return {
    animation: false,
    textStyle: { fontFamily },
    grid: PANEL_GRID,
    xAxis,
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
          scale !== null && value === scale.max && unit !== ""
            ? formatWithUnit(value, unit, digits)
            : formatDecimal(value, digits),
      },
    },
    tooltip: {
      trigger: "axis",
      ...tooltipStyle(tokens),
      axisPointer: { type: "line", lineStyle: { color: tokens.cursor, width: 1 } },
      formatter: (params) => {
        const first = Array.isArray(params) ? params[0] : params;
        return first ? weightLoadTooltip(points, first.dataIndex, today) : "";
      },
    },
    series: [
      {
        type: "line",
        data: [...values],
        color,
        lineStyle: { color, width: 2 },
        areaStyle: undefined,
        emphasis: { disabled: true },
        showSymbol: false,
      },
    ],
  };
}

/** The weight panel and the load panel, in the order they are stacked. */
export function buildWeightAgainstLoadOptions({ points, tokens, today }: WeightAgainstLoadInput): {
  weight: ChartOption;
  load: ChartOption;
} {
  const weights = points.map((point) => point.trend_kg);
  const loads = points.map((point) => point.ctl);
  const shared = { points, xAxis: sharedXAxis(points, tokens, today), tokens, today };

  return {
    weight: panel({
      ...shared,
      values: weights,
      scale: panelScale(weights, MIN_WEIGHT_SPAN_KG),
      color: tokens.ink,
      digits: 1,
      unit: "kg",
    }),
    load: panel({
      ...shared,
      values: loads,
      scale: panelScale(loads, MIN_CTL_SPAN, 0),
      // Blue, because CTL is a training magnitude and blue is the one magnitude ramp
      // (Rules). The *middle* step rather than an end: the ramp runs dark-to-light in
      // dark mode, so its top is near-white there and the load panel would come out
      // the same colour as the weight panel above it, reading as one line cut in half.
      color: loadColor(tokens),
      digits: 0,
      unit: "",
    }),
  };
}
