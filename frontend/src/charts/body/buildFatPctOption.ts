// Body fat as a percentage, smoothed the way the masses beside it are.
//
// Separate from the fat/lean chart, which is in kilograms: losing 2 kg of fat and
// gaining 2 kg of muscle leaves the percentage barely moved, and the two answers are
// both worth having. The percentage is the one the owner asked for by name.
import type { BodySeries } from "@/api/queries/useBody";
import { decimalStep, padded, quantileRange, snapToStep, withMinSpan } from "@/charts/axisScale";
import {
  axisLabelStyle,
  gridLineStyle,
  quietAxis,
  tooltipStyle,
  zoomControls,
} from "@/charts/chrome";
import type { ChartOption } from "@/charts/echarts";
import { dayAxis, HEALTH_CHART_GRID_ZOOMED } from "@/charts/health/dayAxis";
import type { ColorTokens } from "@/design/tokens";
import { fontFamily } from "@/design/typography";
import { formatDate, formatDecimal, formatWithUnit, MISSING } from "@/lib/format";

export interface FatPctInput {
  series: BodySeries;
  tokens: ColorTokens;
  today?: Date;
}

const MAX_Y_INTERVALS = 3;
const Y_PADDING = 0.08;

/** Under this a steady year fills the chart with rounding noise. */
export const MIN_FAT_SPAN_PCT = 3;

/** Whether the scale ever reported a percentage; without one there is no chart. */
export function hasFatPct(series: BodySeries): boolean {
  return (series.fat_pct ?? []).some((value) => value !== null);
}

export function fatPctScale(series: BodySeries) {
  const range = quantileRange(series.fat_pct ?? [], 0, 1);
  if (range === null) return null;
  const spread = padded(withMinSpan(range, MIN_FAT_SPAN_PCT), Y_PADDING);
  const step = decimalStep(spread[1] - spread[0], MAX_Y_INTERVALS);
  const [min, max] = snapToStep(spread, step);
  return { min, max, step };
}

/** "Sep 23 · 27.4 %". */
export function fatPctTooltip(series: BodySeries, index: number, today?: Date): string {
  const day = series.days[index];
  if (day === undefined) return "";
  const value = (series.fat_pct ?? [])[index] ?? null;
  return [formatDate(day, today), value === null ? MISSING : formatWithUnit(value, "%", 1)].join(
    " · ",
  );
}

export function buildFatPctOption({ series, tokens, today }: FatPctInput): ChartOption {
  const scale = fatPctScale(series);

  return {
    animation: false,
    textStyle: { fontFamily },
    grid: HEALTH_CHART_GRID_ZOOMED,
    dataZoom: zoomControls(tokens),
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
            ? formatWithUnit(value, "%", 1)
            : formatDecimal(value, 1),
      },
    },
    tooltip: {
      trigger: "axis",
      ...tooltipStyle(tokens),
      axisPointer: { type: "line", lineStyle: { color: tokens.cursor, width: 1 } },
      formatter: (params) => {
        const first = Array.isArray(params) ? params[0] : params;
        return first ? fatPctTooltip(series, first.dataIndex, today) : "";
      },
    },
    series: [
      {
        type: "line",
        name: "Body fat",
        data: [...(series.fat_pct ?? [])],
        color: tokens.ink,
        lineStyle: { color: tokens.ink, width: 2 },
        emphasis: { disabled: true },
        showSymbol: false,
        // A gap is a stretch with no weigh-ins, and is drawn as one.
        connectNulls: false,
      },
    ],
  };
}
