// One recovery metric a day, with its own 28-day rolling baseline over it. The two are
// told apart by weight, not colour: the daily reading is a hairline, the baseline — the
// thing worth reading — is the solid line, labelled at its end.
import type { MetricTrend } from "@/api/queries/useHealth";
import { decimalStep, padded, quantileRange, snapToStep, withMinSpan } from "@/charts/axisScale";
import { axisLabelStyle, gridLineStyle, quietAxis, tooltipStyle } from "@/charts/chrome";
import type { ChartOption } from "@/charts/echarts";
import { dayAxis, HEALTH_CHART_GRID } from "@/charts/health/dayAxis";
import type { ColorTokens } from "@/design/tokens";
import { fontFamily, fontSize } from "@/design/typography";
import { scaled, type HealthMetric } from "@/features/health/healthMetrics";
import { formatDate, formatDecimal, formatWithUnit, MISSING } from "@/lib/format";

export interface MetricTrendInput {
  trend: MetricTrend;
  metric: HealthMetric;
  tokens: ColorTokens;
  today?: Date;
}

export const BASELINE_LABEL = "28-day";

const MAX_Y_INTERVALS = 3;
// Fraction of the data's span added above and below the line.
const Y_PADDING = 0.05;

export interface MetricScale {
  min: number;
  max: number;
  step: number;
}

/** Y bounds and a tick step on round values, or null when nothing was recorded. */
export function metricTrendScale(
  values: readonly (number | null)[],
  metric: HealthMetric,
): MetricScale | null {
  const range = quantileRange(values, 0, 1);
  if (range === null) return null;

  const spread = padded(withMinSpan(range, metric.minSpan), Y_PADDING);
  const step = decimalStep(spread[1] - spread[0], MAX_Y_INTERVALS);
  const [min, max] = snapToStep(spread, step);
  return { min, max, step };
}

/** "Sep 23 · 56 bpm · 28-day 57". */
export function metricTrendTooltip(
  trend: MetricTrend,
  metric: HealthMetric,
  index: number,
  today?: Date,
): string {
  const day = trend.days[index];
  if (day === undefined) return "";
  const value = scaled(trend.values[index] ?? null, metric);
  const baseline = scaled(trend.roll28[index] ?? null, metric);
  return [
    formatDate(day, today),
    value === null ? MISSING : formatWithUnit(value, metric.unit, metric.digits),
    `${BASELINE_LABEL} ${formatDecimal(baseline, metric.digits)}`,
  ].join(" · ");
}

export function buildMetricTrendOption({
  trend,
  metric,
  tokens,
  today,
}: MetricTrendInput): ChartOption {
  const values = trend.values.map((value) => scaled(value, metric));
  const baseline = trend.roll28.map((value) => scaled(value, metric));
  const scale = metricTrendScale(values, metric);

  return {
    animation: false,
    textStyle: { fontFamily },
    grid: HEALTH_CHART_GRID,
    xAxis: dayAxis(trend.days, tokens, today),
    yAxis: {
      type: "value",
      min: scale?.min,
      max: scale?.max,
      interval: scale?.step,
      ...quietAxis,
      splitLine: gridLineStyle(tokens),
      // The unit once, on the top tick, as the pace axis carries "/km".
      axisLabel: {
        ...axisLabelStyle(tokens),
        formatter: (value: number) =>
          scale !== null && value === scale.max
            ? formatWithUnit(value, metric.unit, metric.digits)
            : formatDecimal(value, metric.digits),
      },
    },
    tooltip: {
      trigger: "axis",
      ...tooltipStyle(tokens),
      axisPointer: { type: "line", lineStyle: { color: tokens.cursor, width: 1 } },
      formatter: (params) => {
        const first = Array.isArray(params) ? params[0] : params;
        return first ? metricTrendTooltip(trend, metric, first.dataIndex, today) : "";
      },
    },
    series: [
      {
        type: "line",
        name: metric.label,
        data: values,
        color: tokens.inkMuted,
        lineStyle: { color: tokens.inkMuted, width: 1 },
        emphasis: { disabled: true },
        showSymbol: false,
        // A gap in the data is a night the watch was off, not a straight line through it.
        connectNulls: false,
      },
      {
        type: "line",
        name: BASELINE_LABEL,
        data: baseline,
        color: tokens.ink,
        lineStyle: { color: tokens.ink, width: 2 },
        emphasis: { disabled: true },
        showSymbol: false,
        // A trailing 28-day mean is null only when all 28 of those days are, so the
        // one thing joining across it would draw is a baseline for a month the watch
        // was off. It breaks where the daily line does.
        connectNulls: false,
        endLabel: {
          show: true,
          formatter: BASELINE_LABEL,
          color: tokens.ink,
          fontFamily,
          fontSize: fontSize.caption,
        },
      },
    ],
  };
}
