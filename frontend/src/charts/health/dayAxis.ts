// Chrome shared by the four Health charts, which all plot one point per calendar day
// over the same window: the same x-axis, and the same four date labels along it.
import { axisLabelStyle, chartGrid, gridLineStyle, quietAxis } from "@/charts/chrome";
import type { ChartOption } from "@/charts/echarts";
import type { ColorTokens } from "@/design/tokens";
import { formatDate, formatMonth } from "@/lib/format";

/** Enough labels to place a point in the year, few enough to stay readable. */
const X_LABELS = 4;

/**
 * The side gutters of every Health chart. The right is wide to leave room for a series'
 * `endLabel`. The selection overlay is positioned from these, so they are shared.
 */
export const HEALTH_GUTTERS = { left: 44, right: 56 } as const;
export const HEALTH_CHART_GRID = chartGrid(HEALTH_GUTTERS);

type CategoryAxis = Extract<ChartOption["xAxis"], { type?: "category" }>;
type ValueAxis = Extract<ChartOption["yAxis"], { type?: "value" }>;

/** Beyond this many days the labels carry month and year: "Aug 10, 2014" is too wide for four. */
const MONTH_LABELS_FROM_DAYS = 240;

const MS_PER_DAY = 86_400_000;

function spanDays(days: readonly string[]): number {
  const first = days[0];
  const last = days[days.length - 1];
  if (first === undefined || last === undefined) return 0;
  return (Date.parse(last) - Date.parse(first)) / MS_PER_DAY;
}

/** One category per point, labelled four times, with no vertical gridlines. */
export function dayAxis(days: readonly string[], tokens: ColorTokens, today?: Date): CategoryAxis {
  const monthLabels = spanDays(days) > MONTH_LABELS_FROM_DAYS;
  return {
    type: "category",
    data: [...days],
    ...quietAxis,
    splitLine: { show: false },
    axisLabel: {
      ...axisLabelStyle(tokens),
      interval: Math.max(Math.floor(days.length / X_LABELS) - 1, 0),
      // The outer labels sit inside the plot, not centred on its edges, where they ran
      // into the y-axis labels beside them.
      alignMinLabel: "left",
      alignMaxLabel: "right",
      formatter: (value: string) =>
        monthLabels ? formatMonth(value.slice(0, 7)) : formatDate(value, today),
    },
  };
}

/** A 0-100 score axis (Body Battery, readiness): fixed bounds, three ticks. */
export function scoreAxis(tokens: ColorTokens): ValueAxis {
  return {
    type: "value",
    min: 0,
    max: 100,
    interval: 50,
    ...quietAxis,
    splitLine: gridLineStyle(tokens),
    axisLabel: axisLabelStyle(tokens),
  };
}
