// Chrome shared by the four Health charts, which all plot one point per calendar day
// over the same window: the same x-axis, and the same four date labels along it.
import { axisLabelStyle, chartGrid, gridLineStyle, quietAxis, ZOOM_GUTTER } from "@/charts/chrome";
import type { ChartOption } from "@/charts/echarts";
import type { ColorTokens } from "@/design/tokens";
import { formatDate } from "@/lib/format";

/** Enough labels to place a point in the year, few enough to stay readable. */
const X_LABELS = 4;

/** The right gutter is wide to leave room for the baseline series' `endLabel`. */
export const HEALTH_CHART_GRID = chartGrid({ left: 44, right: 56 });

/** The same plot area, with room under it for the zoom slider. */
export const HEALTH_CHART_GRID_ZOOMED = {
  ...HEALTH_CHART_GRID,
  bottom: HEALTH_CHART_GRID.bottom + ZOOM_GUTTER,
} as const;

type CategoryAxis = Extract<ChartOption["xAxis"], { type?: "category" }>;
type ValueAxis = Extract<ChartOption["yAxis"], { type?: "value" }>;

/** One category per day, labelled four times, with no vertical gridlines. */
export function dayAxis(days: readonly string[], tokens: ColorTokens, today?: Date): CategoryAxis {
  return {
    type: "category",
    data: [...days],
    ...quietAxis,
    splitLine: { show: false },
    axisLabel: {
      ...axisLabelStyle(tokens),
      interval: Math.max(Math.floor(days.length / X_LABELS) - 1, 0),
      formatter: (value: string) => formatDate(value, today),
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
