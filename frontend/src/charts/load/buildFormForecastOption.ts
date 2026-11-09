import type { components } from "@/api/schema";
import { axisLabelStyle, chartGrid, gridLineStyle, quietAxis, tooltipStyle } from "@/charts/chrome";
import type { ChartOption } from "@/charts/echarts";
import type { ColorTokens } from "@/design/tokens";
import { fontFamily } from "@/design/typography";
import { formatDate, formatSigned } from "@/lib/format";

type ForecastDay = components["schemas"]["ForecastDay"];

/** The window a taper aims for. Mirrors the backend's `FRESH_LOW` and `FRESH_HIGH`. */
export const FRESH_WINDOW = { low: 5, high: 25 } as const;

export interface FormForecastInput {
  curve: readonly ForecastDay[];
  tokens: ColorTokens;
  /** For "is this the current year" in date labels; injectable for tests. */
  today?: Date;
}

/** "Jan 8 · Form +9.3", with the prescription beside it when sessions are skipped. */
export function formForecastTooltip(day: ForecastDay, today?: Date): string {
  const parts = [formatDate(day.day, today), `Form ${formatSigned(day.tsb_followed ?? day.tsb)}`];
  if (day.tsb_followed !== null) parts.push(`as planned ${formatSigned(day.tsb)}`);
  return parts.join(" · ");
}

/**
 * One point a week, counting back from race morning so the last is always the day that
 * matters. Daily form swings with every hard session and the swing is noise at this
 * distance: the trend to the start line is what is being read.
 */
export function weeklyPoints(curve: readonly ForecastDay[]): ForecastDay[] {
  const last = curve.length - 1;
  return curve.filter((_, i) => i === 0 || (last - i) % 7 === 0);
}

/**
 * Form (TSB) from today to race morning. One axis, one thing: the line is what you will
 * probably have, at your recent kilometres, and the dashed line is every session done as
 * written. The band behind them is where a taper should land you.
 */
export function buildFormForecastOption({
  curve: daily,
  tokens,
  today,
}: FormForecastInput): ChartOption {
  const curve = weeklyPoints(daily);
  const hasFollowed = curve.some((d) => d.tsb_followed !== null);
  const main = curve.map((d) => d.tsb_followed ?? d.tsb);

  return {
    animation: false,
    textStyle: { fontFamily },
    grid: chartGrid({ left: 36, right: 12 }),
    xAxis: {
      type: "category",
      data: curve.map((d) => d.day),
      boundaryGap: false,
      ...quietAxis,
      splitLine: { show: false },
      axisLabel: {
        ...axisLabelStyle(tokens),
        interval: Math.max(Math.floor(curve.length / 4) - 1, 0),
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
        const day = first ? curve[first.dataIndex] : undefined;
        return day ? formForecastTooltip(day, today) : "";
      },
    },
    series: [
      {
        type: "line",
        name: "Form",
        data: main,
        color: tokens.ink,
        lineStyle: { color: tokens.ink, width: 2 },
        emphasis: { disabled: true },
        showSymbol: false,
        z: 3,
        markArea: {
          silent: true,
          itemStyle: { color: tokens.surfaceMuted },
          data: [[{ yAxis: FRESH_WINDOW.low }, { yAxis: FRESH_WINDOW.high }]],
        },
        markLine: {
          silent: true,
          symbol: "none",
          label: { show: false },
          lineStyle: { color: tokens.axis, width: 1 },
          data: [{ yAxis: 0 }],
        },
      },
      ...(hasFollowed
        ? [
            {
              type: "line" as const,
              name: "As planned",
              data: curve.map((d) => d.tsb),
              color: tokens.inkSecondary,
              lineStyle: { color: tokens.inkSecondary, width: 1.5, type: "dashed" as const },
              emphasis: { disabled: true },
              showSymbol: false,
              z: 2,
            },
          ]
        : []),
    ],
  };
}
