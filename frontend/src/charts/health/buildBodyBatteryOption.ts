// The day's Body Battery peak and trough, on the 0-100 scale the watch reports them on.
// Two lines on one axis: they are the same measurement at two moments, not two metrics.
import type { DailyRow } from "@/api/queries/useHealth";
import { tooltipStyle } from "@/charts/chrome";
import type { ChartOption } from "@/charts/echarts";
import { dayAxis, HEALTH_CHART_GRID, scoreAxis } from "@/charts/health/dayAxis";
import type { ColorTokens } from "@/design/tokens";
import { fontFamily, fontSize } from "@/design/typography";
import { formatDate, formatInteger } from "@/lib/format";

export interface BodyBatteryInput {
  rows: readonly DailyRow[];
  tokens: ColorTokens;
  today?: Date;
}

/** "Sep 23 · High 61 · Low 10". */
export function bodyBatteryTooltip(row: DailyRow, today?: Date): string {
  return [
    formatDate(row.day, today),
    `High ${formatInteger(row.bb_high)}`,
    `Low ${formatInteger(row.bb_low)}`,
  ].join(" · ");
}

export function bodyBatteryDays(rows: readonly DailyRow[]): boolean {
  return rows.some((row) => row.bb_high !== null || row.bb_low !== null);
}

export function buildBodyBatteryOption({ rows, tokens, today }: BodyBatteryInput): ChartOption {
  const endLabel = (text: string, color: string) => ({
    show: true,
    formatter: text,
    color,
    fontFamily,
    fontSize: fontSize.caption,
  });

  return {
    animation: false,
    textStyle: { fontFamily },
    grid: HEALTH_CHART_GRID,
    xAxis: dayAxis(
      rows.map((row) => row.day),
      tokens,
      today,
    ),
    yAxis: scoreAxis(tokens),
    tooltip: {
      trigger: "axis",
      ...tooltipStyle(tokens),
      axisPointer: { type: "line", lineStyle: { color: tokens.cursor, width: 1 } },
      formatter: (params) => {
        const first = Array.isArray(params) ? params[0] : params;
        const row = first ? rows[first.dataIndex] : undefined;
        return row ? bodyBatteryTooltip(row, today) : "";
      },
    },
    series: [
      {
        type: "line",
        name: "High",
        data: rows.map((row) => row.bb_high),
        color: tokens.ink,
        lineStyle: { color: tokens.ink, width: 1.5 },
        emphasis: { disabled: true },
        showSymbol: false,
        connectNulls: false,
        endLabel: endLabel("High", tokens.ink),
      },
      {
        type: "line",
        name: "Low",
        data: rows.map((row) => row.bb_low),
        color: tokens.inkMuted,
        lineStyle: { color: tokens.inkMuted, width: 1.5 },
        emphasis: { disabled: true },
        showSymbol: false,
        connectNulls: false,
        endLabel: endLabel("Low", tokens.inkMuted),
      },
    ],
  };
}
