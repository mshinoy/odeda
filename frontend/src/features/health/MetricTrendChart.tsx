import { useMemo } from "react";
import type { MetricTrend } from "@/api/queries/useHealth";
import { buildMetricTrendOption } from "@/charts/health/buildMetricTrendOption";
import { summarizeMetric } from "@/charts/health/rangeStats";
import { resolutionFor, resolveTrend } from "@/charts/health/resolution";
import { windowTrend } from "@/charts/health/windowData";
import { useTokens } from "@/design/theme";
import { HealthChart } from "@/features/health/HealthChart";
import { METRIC_DESCRIPTIONS, type HealthMetric } from "@/features/health/healthMetrics";
import { useChartZoom, zoomKey } from "@/features/health/useChartZoom";

interface MetricTrendChartProps {
  metric: HealthMetric;
  trend: MetricTrend;
}

/** One metric a day, with its 28-day baseline drawn over it. */
export function MetricTrendChart({ metric, trend }: MetricTrendChartProps) {
  const tokens = useTokens();
  const zoom = useChartZoom(zoomKey(trend.days));
  const view = useMemo(() => windowTrend(trend, zoom.zoom), [trend, zoom.zoom]);
  const resolution = resolutionFor(view.days.length);
  const drawn = useMemo(() => resolveTrend(view, resolution), [view, resolution]);
  const option = useMemo(
    () => buildMetricTrendOption({ trend: drawn, metric, tokens, resolution }),
    [drawn, metric, tokens, resolution],
  );
  const stats = useMemo(
    () => summarizeMetric(windowTrend(view, zoom.selection), metric),
    [view, zoom.selection, metric],
  );

  return (
    <HealthChart
      title={metric.label}
      description={METRIC_DESCRIPTIONS[metric.key] ?? ""}
      option={option}
      days={drawn.days}
      resolution={resolution}
      zoom={zoom}
      stats={stats}
    />
  );
}
