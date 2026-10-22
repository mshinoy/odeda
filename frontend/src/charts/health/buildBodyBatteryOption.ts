// The day's Body Battery peak and trough, on the 0-100 scale the watch reports them on.
// Two lines on one axis: they are the same measurement at two moments, not two metrics.
import type { DailyRow } from "@/api/queries/useHealth";
import { hoveredIndex, tooltipHtml, tooltipStyle, type TooltipCard } from "@/charts/chrome";
import type { ChartOption } from "@/charts/echarts";
import { dayAxis, HEALTH_CHART_GRID, scoreAxis } from "@/charts/health/dayAxis";
import { dayHeading, type Resolution } from "@/charts/health/resolution";
import type { ColorTokens } from "@/design/tokens";
import { fontFamily, fontSize } from "@/design/typography";
import { formatInteger } from "@/lib/format";

export interface BodyBatteryInput {
  /** Already at `resolution`: a week's average peak and trough when that is "week". */
  rows: readonly DailyRow[];
  tokens: ColorTokens;
  today?: Date;
  resolution?: Resolution;
}

/** "Sep 23": the day's high and low, and how far it ran down between them. */
export function bodyBatteryTooltip(
  row: DailyRow,
  today?: Date,
  resolution: Resolution = "day",
  tokens?: ColorTokens,
): TooltipCard {
  const drain = row.bb_high !== null && row.bb_low !== null ? row.bb_high - row.bb_low : null;
  return {
    heading: dayHeading(row.day, resolution, today),
    rows: [
      { label: "High", value: formatInteger(row.bb_high), color: tokens?.ink },
      { label: "Low", value: formatInteger(row.bb_low), color: tokens?.inkMuted },
      { label: "Range", value: formatInteger(drain) },
    ],
  };
}

export function bodyBatteryDays(rows: readonly DailyRow[]): boolean {
  return rows.some((row) => row.bb_high !== null || row.bb_low !== null);
}

export function buildBodyBatteryOption({
  rows,
  tokens,
  today,
  resolution = "day",
}: BodyBatteryInput): ChartOption {
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
        const index = hoveredIndex(params);
        const row = index === null ? undefined : rows[index];
        return row ? tooltipHtml(bodyBatteryTooltip(row, today, resolution, tokens), tokens) : "";
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
