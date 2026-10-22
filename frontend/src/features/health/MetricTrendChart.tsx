import { useMemo } from "react";
import type { MetricTrend } from "@/api/queries/useHealth";
import { buildMetricTrendOption } from "@/charts/health/buildMetricTrendOption";
import { resolutionFor, resolveTrend } from "@/charts/health/resolution";
import { useTokens } from "@/design/theme";
import { HealthChart } from "@/features/health/HealthChart";
import type { HealthMetric } from "@/features/health/healthMetrics";

interface MetricTrendChartProps {
  metric: HealthMetric;
  trend: MetricTrend;
}

/** One metric a day, with its 28-day baseline drawn over it. */
export function MetricTrendChart({ metric, trend }: MetricTrendChartProps) {
  const tokens = useTokens();
  const option = useMemo(() => {
    const resolution = resolutionFor(trend.days.length);
    return buildMetricTrendOption({
      trend: resolveTrend(trend, resolution),
      metric,
      tokens,
      resolution,
    });
  }, [trend, metric, tokens]);

  return <HealthChart label={metric.label} option={option} />;
}
