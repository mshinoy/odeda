// Distance per calendar month, as plain neutral bars. One quantity, one axis, one
// colour: colour in this app means activity kind or metric magnitude, and a month is
// neither. The bars are evenly spaced because `toMonthPoints` has already put the
// empty months back, so a year off reads as a year off.
import {
  axisLabelStyle,
  BAR_TOP_RADIUS,
  barHoverPointer,
  chartGrid,
  gridLineStyle,
  quietAxis,
  tooltipStyle,
} from "@/charts/chrome";
import { decimalStep } from "@/charts/axisScale";
import type { ChartOption } from "@/charts/echarts";
import type { ColorTokens } from "@/design/tokens";
import { fontFamily } from "@/design/typography";
import type { MonthPoint } from "@/features/trends/monthlySeries";
import { formatDistance, formatMonth, MISSING } from "@/lib/format";

export interface MonthlyDistanceInput {
  points: readonly MonthPoint[];
  tokens: ColorTokens;
}

/** Enough labels to find a year, few enough to read. */
const X_LABELS = 5;
const METRES_PER_KM = 1000;
const MAX_Y_INTERVALS = 3;

/**
 * Axis top and step, in metres, on a round number of kilometres. The app picks these
 * rather than ECharts so the top tick is known, and can be the one that carries "km".
 */
export function monthlyDistanceScale(points: readonly MonthPoint[]): {
  max: number;
  step: number;
} {
  const peak = points.reduce((high, point) => Math.max(high, point.distanceM ?? 0), 0);
  const stepKm = decimalStep(peak / METRES_PER_KM, MAX_Y_INTERVALS) || 1;
  const maxKm = Math.ceil(peak / METRES_PER_KM / stepKm) * stepKm;
  return {
    max: Math.max(maxKm, stepKm) * METRES_PER_KM,
    step: stepKm * METRES_PER_KM,
  };
}

/** "Sep 2026 · 42.4 km", or the month and a dash where nothing was recorded. */
export function monthlyDistanceTooltip(point: MonthPoint): string {
  const distance = point.distanceM === null ? MISSING : formatDistance(point.distanceM);
  return `${formatMonth(point.period)} · ${distance}`;
}

export function buildMonthlyDistanceOption({ points, tokens }: MonthlyDistanceInput): ChartOption {
  const scale = monthlyDistanceScale(points);

  return {
    animation: false,
    textStyle: { fontFamily },
    grid: chartGrid({ left: 48, right: 16 }),
    xAxis: {
      type: "category",
      data: points.map((point) => point.period),
      ...quietAxis,
      splitLine: { show: false },
      axisLabel: {
        ...axisLabelStyle(tokens),
        interval: Math.max(Math.floor(points.length / X_LABELS) - 1, 0),
        formatter: (value: string) => formatMonth(value),
      },
    },
    yAxis: {
      type: "value",
      min: 0,
      max: scale.max,
      interval: scale.step,
      ...quietAxis,
      splitLine: gridLineStyle(tokens),
      // Kilometres, because a month of metres is a five-digit tick, and "km" once on
      // the top one, as the pace axis carries "/km".
      axisLabel: {
        ...axisLabelStyle(tokens),
        formatter: (value: number) =>
          value === scale.max ? formatDistance(value) : String(Math.round(value / METRES_PER_KM)),
      },
    },
    tooltip: {
      trigger: "axis",
      ...tooltipStyle(tokens),
      axisPointer: barHoverPointer(tokens),
      formatter: (params) => {
        const first = Array.isArray(params) ? params[0] : params;
        const point = first ? points[first.dataIndex] : undefined;
        return point ? monthlyDistanceTooltip(point) : "";
      },
    },
    series: [
      {
        type: "bar",
        name: "Distance",
        data: points.map((point) => point.distanceM),
        color: tokens.inkSecondary,
        itemStyle: { color: tokens.inkSecondary, borderRadius: BAR_TOP_RADIUS },
        emphasis: { itemStyle: { color: tokens.ink } },
        barCategoryGap: "20%",
      },
    ],
  };
}
