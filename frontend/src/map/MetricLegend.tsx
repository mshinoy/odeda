import type { ColorTokens } from "@/design/tokens";
import type { ActivityKind } from "@/lib/activityKind";
import { metricLabel, metrics, type MetricKey } from "@/lib/metrics";
import { RampLegend } from "@/map/RampLegend";

interface MetricLegendProps {
  colorBy: MetricKey;
  /** The value range the route colours span (see `activityMetricRange`). */
  range: [number, number];
  /** Picks the unit for pace: /km on foot, km/h on a bike, /100m in water. */
  kind: ActivityKind;
  tokens: ColorTokens;
}

/** The route's colour ramp with the values at each end, low on the left. */
export function MetricLegend({ colorBy, range, kind, tokens }: MetricLegendProps) {
  const metric = metrics[colorBy];

  return (
    <RampLegend
      low={metric.formatScaleValue(range[0], kind)}
      high={metric.formatScaleValue(range[1], kind)}
      label={metricLabel(metric, kind)}
      tokens={tokens}
    />
  );
}
