import type { ColorTokens } from "@/design/tokens";
import type { ActivityKind } from "@/lib/activityKind";
import { metrics, type MetricKey } from "@/lib/metrics";
import { steppedGradient } from "@/map/legend";

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
  const lowLabel = metric.formatScaleValue(range[0], kind);
  const highLabel = metric.formatScaleValue(range[1], kind);
  const barStyle = { backgroundImage: steppedGradient(tokens.metricRamp) };

  return (
    <div
      role="img"
      aria-label={`${metric.label}: ${lowLabel} to ${highLabel}`}
      className="bg-background/90 text-muted-foreground flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs tabular-nums shadow-sm backdrop-blur"
    >
      <span>{lowLabel}</span>
      <div className="h-1.5 w-24 rounded-full" style={barStyle} />
      <span>{highLabel}</span>
    </div>
  );
}
