// Run speed and bodyweight, each as a percentage of where it started.
//
// Deliberately not "pace per kilogram". Running's metabolic cost is already roughly
// proportional to bodyweight, so speed is a mass-normalised quantity to begin with and
// dividing it by mass again produces a number with no meaning. Every honest version of
// "how much of this improvement is the weight?" is a rule of thumb, and there is
// exactly one of those in this app, on the race projection, labelled as one.
//
// What this shows instead is both series side by side: speed up 14 % against weight
// down 5 % is an improvement the scale does not explain. That is a comparison the
// reader makes, not a conversion the code invents — and unlike kilograms against CTL,
// two percentages of a starting value really do belong on one axis.
import { decimalStep, padded, quantileRange, snapToStep, withMinSpan } from "@/charts/axisScale";
import { axisLabelStyle, chartGrid, gridLineStyle, quietAxis, tooltipStyle } from "@/charts/chrome";
import type { ChartOption } from "@/charts/echarts";
import type { SpeedWeightPoint } from "@/api/queries/useBody";
import type { ColorTokens } from "@/design/tokens";
import { fontFamily } from "@/design/typography";
import { formatDate, formatDecimal } from "@/lib/format";

export interface SpeedWeightInput {
  points: readonly SpeedWeightPoint[];
  tokens: ColorTokens;
  today?: Date;
}

const MAX_Y_INTERVALS = 4;
const Y_PADDING = 0.1;
const X_LABELS = 4;

/** Percentage points. Under this a steady year fills the chart with rounding. */
export const MIN_INDEX_SPAN = 8;

/** The two series, in the order they are drawn and listed in the legend. */
export const INDEX_SERIES = [
  { key: "speed_index", label: "Speed", index: 0 },
  { key: "weight_index", label: "Weight", index: 1 },
] as const;

export function indexColors(tokens: ColorTokens): Record<string, string> {
  return Object.fromEntries(
    INDEX_SERIES.map(({ label, index }) => [label, tokens.series[index] ?? tokens.ink]),
  );
}

/** One axis in percent, always containing 100 — the week both series start from. */
export function indexScale(
  points: readonly SpeedWeightPoint[],
): { min: number; max: number; step: number } | null {
  const values = points.flatMap((point) => [point.speed_index, point.weight_index]);
  const range = quantileRange(values, 0, 1);
  if (range === null) return null;
  const withStart: [number, number] = [Math.min(range[0], 100), Math.max(range[1], 100)];
  const spread = padded(withMinSpan(withStart, MIN_INDEX_SPAN), Y_PADDING);
  const step = decimalStep(spread[1] - spread[0], MAX_Y_INTERVALS);
  const [min, max] = snapToStep(spread, step);
  return { min, max, step };
}

/** "Week of Sep 14 · speed 114 · weight 95 (% of the first week)". */
export function speedWeightTooltip(
  points: readonly SpeedWeightPoint[],
  index: number,
  today?: Date,
): string {
  const point = points[index];
  if (point === undefined) return "";
  return [
    `Week of ${formatDate(point.week, today)}`,
    `speed ${formatDecimal(point.speed_index, 0)}`,
    `weight ${formatDecimal(point.weight_index, 0)} (% of the first week)`,
  ].join(" · ");
}

export function buildSpeedWeightOption({ points, tokens, today }: SpeedWeightInput): ChartOption {
  const scale = indexScale(points);
  const colors = indexColors(tokens);

  return {
    animation: false,
    textStyle: { fontFamily },
    grid: chartGrid({ left: 44, right: 16 }),
    xAxis: {
      type: "category",
      data: points.map((point) => point.week),
      ...quietAxis,
      splitLine: { show: false },
      axisLabel: {
        ...axisLabelStyle(tokens),
        interval: Math.max(Math.floor(points.length / X_LABELS) - 1, 0),
        formatter: (value: string) => formatDate(value, today),
      },
    },
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
            ? `${formatDecimal(value, 0)}%`
            : formatDecimal(value, 0),
      },
    },
    tooltip: {
      trigger: "axis",
      ...tooltipStyle(tokens),
      axisPointer: { type: "line", lineStyle: { color: tokens.cursor, width: 1 } },
      formatter: (params) => {
        const first = Array.isArray(params) ? params[0] : params;
        return first ? speedWeightTooltip(points, first.dataIndex, today) : "";
      },
    },
    series: INDEX_SERIES.map(({ key, label }) => ({
      type: "line" as const,
      name: label,
      data: points.map((point) => point[key]),
      color: colors[label],
      lineStyle: { color: colors[label], width: 2 },
      emphasis: { disabled: true },
      showSymbol: false,
    })),
  };
}
