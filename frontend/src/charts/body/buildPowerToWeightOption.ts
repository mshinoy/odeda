// Watts per kilogram, one point per ride.
//
// The one genuinely physiological normalisation in this app. On a climb, speed is very
// nearly linear in W/kg, so this is a real performance number rather than a conversion
// with a caveat attached — and unlike run pace, dividing by mass is exactly the right
// thing to do with it.
//
// A scatter, not a line: each point is one ride under its own conditions, and joining
// them would claim a value for the days between, where there was no ride.
import { decimalStep, padded, quantileRange, snapToStep, withMinSpan } from "@/charts/axisScale";
import { axisLabelStyle, chartGrid, gridLineStyle, quietAxis, tooltipStyle } from "@/charts/chrome";
import type { ChartOption } from "@/charts/echarts";
import type { PowerToWeightPoint } from "@/api/queries/useBody";
import type { ColorTokens } from "@/design/tokens";
import { fontFamily } from "@/design/typography";
import { formatDate, formatDecimal } from "@/lib/format";
import { dayToMs, msToDay } from "@/lib/time";

export interface PowerToWeightInput {
  points: readonly PowerToWeightPoint[];
  tokens: ColorTokens;
  today?: Date;
}

const MAX_Y_INTERVALS = 3;
const Y_PADDING = 0.12;
const SYMBOL_SIZE = 6;

/** W/kg. A season of steady riding should not read as a cliff. */
export const MIN_WATTS_SPAN = 0.5;

export function powerScale(
  points: readonly PowerToWeightPoint[],
): { min: number; max: number; step: number } | null {
  const range = quantileRange(
    points.map((point) => point.watts_per_kg),
    0,
    1,
  );
  if (range === null) return null;
  const spread = padded(withMinSpan(range, MIN_WATTS_SPAN), Y_PADDING);
  const step = decimalStep(spread[1] - spread[0], MAX_Y_INTERVALS);
  const [min, max] = snapToStep(spread, step);
  return { min, max, step };
}

/** "Sep 20 · 2.34 W/kg". */
export function powerTooltip(point: PowerToWeightPoint, today?: Date): string {
  return `${formatDate(point.day, today)} · ${formatDecimal(point.watts_per_kg, 2)} W/kg`;
}

export function buildPowerToWeightOption({
  points,
  tokens,
  today,
}: PowerToWeightInput): ChartOption {
  const scale = powerScale(points);
  const labelStyle = axisLabelStyle(tokens);

  return {
    animation: false,
    textStyle: { fontFamily },
    grid: chartGrid({ left: 44, right: 16 }),
    // A time axis, not a category one: rides are weeks apart and spacing them evenly
    // would turn a fortnight off the bike into the same gap as two days.
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
      min: scale?.min,
      max: scale?.max,
      interval: scale?.step,
      ...quietAxis,
      splitLine: gridLineStyle(tokens),
      axisLabel: { ...labelStyle, formatter: (value: number) => formatDecimal(value, 1) },
    },
    tooltip: {
      trigger: "item",
      ...tooltipStyle(tokens),
      formatter: (params) => {
        const first = Array.isArray(params) ? params[0] : params;
        const point = first ? points[first.dataIndex] : undefined;
        return point ? powerTooltip(point, today) : "";
      },
    },
    series: [
      {
        type: "scatter",
        name: "W/kg",
        data: points.map((point) => [dayToMs(point.day), point.watts_per_kg]),
        color: tokens.kind.ride,
        symbolSize: SYMBOL_SIZE,
        emphasis: { disabled: true },
      },
    ],
  };
}
