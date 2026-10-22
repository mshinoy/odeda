import { useMemo } from "react";
import type { ReadinessPoint } from "@/api/queries/useHealth";
import { buildReadinessOption } from "@/charts/health/buildReadinessOption";
import { summarizeReadiness } from "@/charts/health/rangeStats";
import { resolutionFor, resolveReadiness } from "@/charts/health/resolution";
import { windowReadiness } from "@/charts/health/windowData";
import { useTokens } from "@/design/theme";
import { HealthChart } from "@/features/health/HealthChart";
import { useChartZoom, zoomKey } from "@/features/health/useChartZoom";

/** The composite score behind the Status page, over the window. */
export function ReadinessChart({ series }: { series: readonly ReadinessPoint[] }) {
  const tokens = useTokens();
  const zoom = useChartZoom(zoomKey(series.map((point) => point.day)));
  const view = useMemo(() => windowReadiness(series, zoom.zoom), [series, zoom.zoom]);
  const resolution = resolutionFor(view.length);
  const drawn = useMemo(() => resolveReadiness(view, resolution), [view, resolution]);
  const option = useMemo(
    () => buildReadinessOption({ series: drawn, tokens, resolution }),
    [drawn, tokens, resolution],
  );
  const stats = useMemo(
    () => summarizeReadiness(windowReadiness(view, zoom.selection)),
    [view, zoom.selection],
  );

  if (series.every((point) => point.score === null)) return null;

  return (
    <HealthChart
      title="Readiness"
      description="The composite score behind the Status page, 0 to 100, from sleep, HRV, resting heart rate and stress."
      option={option}
      days={drawn.map((point) => point.day)}
      resolution={resolution}
      zoom={zoom}
      stats={stats}
    />
  );
}
