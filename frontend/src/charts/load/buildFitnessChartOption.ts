import type { components } from "@/api/schema";
import { axisLabelStyle, gridLineStyle, quietAxis, tooltipStyle } from "@/charts/chrome";
import type { ChartOption } from "@/charts/echarts";
import type { ColorTokens } from "@/design/tokens";
import { fontFamily } from "@/design/typography";
import { formatDate, formatDecimal, formatSigned } from "@/lib/format";

type LoadDay = components["schemas"]["LoadDay"];

export interface FitnessChartInput {
  curve: readonly LoadDay[];
  tokens: ColorTokens;
  /** How many most recent days to show. */
  days?: number;
  /** For "is this the current year" in date labels; injectable for tests. */
  today?: Date;
}

export const FITNESS_DAYS = 120;

/** The tooltip line for one day: "Sep 22 · Fitness 86.1 · Fatigue 91.0 · Form −4.9". */
export function fitnessTooltip(day: LoadDay, today?: Date): string {
  return [
    formatDate(day.day, today),
    `Fitness ${formatDecimal(day.ctl)}`,
    `Fatigue ${formatDecimal(day.atl)}`,
    `Form ${formatSigned(day.tsb)}`,
  ].join(" · ");
}

/**
 * Fitness (CTL) and fatigue (ATL) over the last few months. Both are on the same load
 * scale, so one axis is honest. They are told apart by weight and a label at the line's
 * end, not by colour: colour in this app means activity kind or metric magnitude.
 */
export function buildFitnessChartOption({
  curve,
  tokens,
  days = FITNESS_DAYS,
  today,
}: FitnessChartInput): ChartOption {
  const recent = curve.slice(-days);
  const endLabel = (text: string, color: string) => ({
    show: true,
    formatter: text,
    color,
    fontFamily,
    fontSize: axisLabelStyle(tokens).fontSize,
  });

  return {
    animation: false,
    textStyle: { fontFamily },
    grid: { left: 40, right: 64, top: 12, bottom: 24 },
    xAxis: {
      type: "category",
      data: recent.map((d) => d.day),
      boundaryGap: false,
      ...quietAxis,
      splitLine: { show: false },
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
      axisPointer: { type: "line", lineStyle: { color: tokens.cursor, width: 1 } },
      formatter: (params) => {
        const first = Array.isArray(params) ? params[0] : params;
        const day = first ? recent[first.dataIndex] : undefined;
        return day ? fitnessTooltip(day, today) : "";
      },
    },
    series: [
      {
        type: "line",
        name: "Fitness",
        data: recent.map((d) => d.ctl),
        color: tokens.ink,
        lineStyle: { color: tokens.ink, width: 2 },
        emphasis: { disabled: true },
        showSymbol: false,
        endLabel: endLabel("Fitness", tokens.ink),
      },
      {
        type: "line",
        name: "Fatigue",
        data: recent.map((d) => d.atl),
        color: tokens.inkMuted,
        lineStyle: { color: tokens.inkMuted, width: 1.5 },
        emphasis: { disabled: true },
        showSymbol: false,
        endLabel: endLabel("Fatigue", tokens.inkMuted),
      },
    ],
  };
}
