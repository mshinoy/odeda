// The composite readiness score over the window, on the same 0-100 axis the Status page
// shows today's on. The band is a status colour, so it stays in the tooltip where it can
// carry its label rather than colouring the line.
import type { ReadinessPoint } from "@/api/queries/useHealth";
import { tooltipStyle } from "@/charts/chrome";
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

/** "Sep 23 · 72 · Ready"; a week's mean has no band, so that part is left off. */
export function readinessTooltip(
  point: ReadinessPoint,
  today?: Date,
  resolution: Resolution = "day",
): string {
  const heading = dayHeading(point.day, resolution, today);
  if (resolution === "week") return [heading, formatInteger(point.score)].join(" · ");
  const band = point.band ? bandDisplay[point.band].label : MISSING;
  return [heading, formatInteger(point.score), band].join(" · ");
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
        const first = Array.isArray(params) ? params[0] : params;
        const point = first ? series[first.dataIndex] : undefined;
        return point ? readinessTooltip(point, today, resolution) : "";
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
