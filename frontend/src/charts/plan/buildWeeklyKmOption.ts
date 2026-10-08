import {
  axisLabelStyle,
  BAR_TOP_RADIUS,
  barHoverPointer,
  chartGrid,
  gridLineStyle,
  quietAxis,
  tooltipStyle,
} from "@/charts/chrome";
import type { ChartOption } from "@/charts/echarts";
import type { ColorTokens } from "@/design/tokens";
import { fontFamily } from "@/design/typography";
import { formatDate, formatDecimal } from "@/lib/format";

export interface WeeklyKmWeek {
  /** Monday, `YYYY-MM-DD`. */
  start: string;
  /** Kilometres actually run that week. */
  km: number;
  /** Kilometres the plan asked for, or null where it asked for nothing. */
  plannedKm: number | null;
}

export interface WeeklyKmInput {
  weeks: readonly WeeklyKmWeek[];
  tokens: ColorTokens;
  today?: Date;
}

/** "Week of Sep 15 · 24.1 km run, 25.2 planned". */
export function weeklyKmTooltip(week: WeeklyKmWeek, today?: Date): string {
  const ran = `${formatDecimal(week.km)} km run`;
  const planned =
    week.plannedKm === null ? "nothing prescribed" : `${formatDecimal(week.plannedKm)} planned`;
  return `Week of ${formatDate(week.start, today)} · ${ran}, ${planned}`;
}

/**
 * Running kilometres a week, with the plan's prescription as a line over the bars.
 *
 * Both series are kilometres, so they share the one y-axis the rules allow: the line
 * is readable against the bars precisely because it is the same quantity. With no plan
 * the line is absent and the bars are the whole chart, which is the empty state D12
 * asks for — curves without a goal line rather than a goal nobody set.
 */
export function buildWeeklyKmOption({ weeks, tokens, today }: WeeklyKmInput): ChartOption {
  const hasPlan = weeks.some((w) => w.plannedKm !== null);

  return {
    animation: false,
    textStyle: { fontFamily },
    grid: chartGrid({ left: 40, right: 12 }),
    xAxis: {
      type: "category",
      data: weeks.map((w) => w.start),
      ...quietAxis,
      axisLabel: {
        ...axisLabelStyle(tokens),
        interval: Math.max(Math.floor(weeks.length / 5) - 1, 0),
        formatter: (value: string) => formatDate(value, today),
      },
    },
    yAxis: {
      type: "value",
      ...quietAxis,
      splitNumber: 3,
      splitLine: gridLineStyle(tokens),
      axisLabel: axisLabelStyle(tokens),
    },
    tooltip: {
      trigger: "axis",
      ...tooltipStyle(tokens),
      axisPointer: barHoverPointer(tokens),
      formatter: (params) => {
        const first = Array.isArray(params) ? params[0] : params;
        const week = first ? weeks[first.dataIndex] : undefined;
        return week ? weeklyKmTooltip(week, today) : "";
      },
    },
    series: [
      {
        name: "Run",
        type: "bar",
        data: weeks.map((w) => w.km),
        color: tokens.kind.run,
        itemStyle: { color: tokens.kind.run, borderRadius: BAR_TOP_RADIUS },
        barCategoryGap: "35%",
      },
      ...(hasPlan
        ? [
            {
              name: "Planned",
              type: "line" as const,
              data: weeks.map((w) => w.plannedKm),
              // A prescription is a step, not a curve: the plan changes on Mondays.
              step: "middle" as const,
              connectNulls: false,
              showSymbol: false,
              lineStyle: { color: tokens.inkSecondary, width: 1.5, type: "dashed" as const },
              color: tokens.inkSecondary,
              z: 3,
            },
          ]
        : []),
    ],
  };
}
