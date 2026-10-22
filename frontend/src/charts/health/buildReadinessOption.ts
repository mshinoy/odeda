// The composite readiness score over the window, on the same 0-100 axis the Status page
// shows today's on. The band is a status colour, so it stays in the tooltip where it can
// carry its label rather than colouring the line.
import type { ReadinessPoint } from "@/api/queries/useHealth";
import { hoveredIndex, tooltipHtml, tooltipStyle, type TooltipCard } from "@/charts/chrome";
import type { ChartOption } from "@/charts/echarts";
import { dayAxis, HEALTH_CHART_GRID, scoreAxis } from "@/charts/health/dayAxis";
import { dayHeading, type Resolution } from "@/charts/health/resolution";
import type { ColorTokens } from "@/design/tokens";
import { fontFamily } from "@/design/typography";
import { bandDisplay } from "@/features/status/readiness";
import { formatInteger, MISSING } from "@/lib/format";

export interface ReadinessChartInput {
  /** Already at `resolution`: a week's mean score per point when that is "week". */
  series: readonly ReadinessPoint[];
  tokens: ColorTokens;
  today?: Date;
  resolution?: Resolution;
}

/** "Sep 23": the score and its band; a week's mean has no band, so that row is left off. */
export function readinessTooltip(
  point: ReadinessPoint,
  today?: Date,
  resolution: Resolution = "day",
  tokens?: ColorTokens,
): TooltipCard {
  const rows: TooltipCard["rows"] = [
    { label: "Score", value: formatInteger(point.score), color: tokens?.ink },
  ];
  const band = point.band ? bandDisplay[point.band].label : MISSING;
  return {
    heading: dayHeading(point.day, resolution, today),
    rows: resolution === "week" ? rows : [...rows, { label: "Status", value: band }],
  };
}

export function buildReadinessOption({
  series,
  tokens,
  today,
  resolution = "day",
}: ReadinessChartInput): ChartOption {
  return {
    animation: false,
    textStyle: { fontFamily },
    grid: HEALTH_CHART_GRID,
    xAxis: dayAxis(
      series.map((point) => point.day),
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
        const point = index === null ? undefined : series[index];
        return point ? tooltipHtml(readinessTooltip(point, today, resolution, tokens), tokens) : "";
      },
    },
    series: [
      {
        type: "line",
        name: "Readiness",
        data: series.map((point) => point.score),
        color: tokens.ink,
        lineStyle: { color: tokens.ink, width: 2 },
        emphasis: { disabled: true },
        showSymbol: false,
        connectNulls: false,
      },
    ],
  };
}
