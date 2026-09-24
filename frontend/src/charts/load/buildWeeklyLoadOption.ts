import type { components } from "@/api/schema";
import {
  axisLabelStyle,
  barHoverPointer,
  gridLineStyle,
  quietAxis,
  tooltipStyle,
} from "@/charts/chrome";
import type { ChartOption } from "@/charts/echarts";
import type { ColorTokens } from "@/design/tokens";
import { fontFamily } from "@/design/typography";
import { formatDate, formatInteger } from "@/lib/format";

type LoadWeek = components["schemas"]["LoadWeek"];

export interface WeeklyLoadInput {
  weeks: readonly LoadWeek[];
  tokens: ColorTokens;
  count?: number;
  today?: Date;
}

export const WEEKLY_LOAD_WEEKS = 12;

/** "Week of Sep 15 · 412". */
export function weeklyLoadTooltip(week: LoadWeek, today?: Date): string {
  return `Week of ${formatDate(week.start, today)} · ${formatInteger(week.load)}`;
}

/** Training load (TRIMP) per ISO week, the most recent weeks, as plain neutral bars. */
export function buildWeeklyLoadOption({
  weeks,
  tokens,
  count = WEEKLY_LOAD_WEEKS,
  today,
}: WeeklyLoadInput): ChartOption {
  const recent = weeks.slice(-count);

  return {
    animation: false,
    textStyle: { fontFamily },
    grid: { left: 40, right: 12, top: 12, bottom: 24 },
    xAxis: {
      type: "category",
      data: recent.map((w) => w.start),
      ...quietAxis,
      axisLabel: {
        ...axisLabelStyle(tokens),
        interval: Math.max(Math.floor(recent.length / 4) - 1, 0),
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
        const week = first ? recent[first.dataIndex] : undefined;
        return week ? weeklyLoadTooltip(week, today) : "";
      },
    },
    series: [
      {
        type: "bar",
        data: recent.map((w) => w.load),
        color: tokens.inkSecondary,
        itemStyle: { color: tokens.inkSecondary, borderRadius: [4, 4, 0, 0] },
        emphasis: { itemStyle: { color: tokens.ink } },
        barCategoryGap: "35%",
      },
    ],
  };
}
