import { useMemo } from "react";
import type { BodySeries } from "@/api/queries/useBody";
import { buildWeightTrendOption } from "@/charts/body/buildWeightTrendOption";
import { summarizeWeight } from "@/charts/health/rangeStats";
import { windowBody } from "@/charts/health/windowData";
import { useTokens } from "@/design/theme";
import { HealthChart } from "@/features/health/HealthChart";
import { useChartZoom, zoomKey } from "@/features/health/useChartZoom";

/** The trend, with the mornings it came from scattered faintly behind it. */
export function WeightTrendChart({ series }: { series: BodySeries }) {
  const tokens = useTokens();
  const zoom = useChartZoom(zoomKey(series.days));
  const view = useMemo(() => windowBody(series, zoom.zoom), [series, zoom.zoom]);
  const option = useMemo(() => buildWeightTrendOption({ series: view, tokens }), [view, tokens]);
  const stats = useMemo(
    () => summarizeWeight(windowBody(view, zoom.selection)),
    [view, zoom.selection],
  );

  return (
    <HealthChart
      title="Weight"
      description="Each morning's weigh-in as a dot, with the smoothed trend as the line. Read the line, not the dots."
      option={option}
      days={view.days}
      resolution="day"
      zoom={zoom}
      stats={stats}
    />
  );
}
