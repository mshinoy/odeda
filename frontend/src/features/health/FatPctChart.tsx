import { useMemo } from "react";
import type { BodySeries } from "@/api/queries/useBody";
import { buildFatPctOption, hasFatPct } from "@/charts/body/buildFatPctOption";
import { summarizeFatPct } from "@/charts/health/rangeStats";
import { windowBody } from "@/charts/health/windowData";
import { useTokens } from "@/design/theme";
import { HealthChart } from "@/features/health/HealthChart";
import { useChartZoom, zoomKey } from "@/features/health/useChartZoom";

/**
 * Body fat as a percentage. Hidden when the scale never reported one — on this account
 * that is every weigh-in before October 2021.
 */
export function FatPctChart({ series }: { series: BodySeries }) {
  const tokens = useTokens();
  const zoom = useChartZoom(zoomKey(series.days));
  const view = useMemo(() => windowBody(series, zoom.zoom), [series, zoom.zoom]);
  const option = useMemo(() => buildFatPctOption({ series: view, tokens }), [view, tokens]);
  const stats = useMemo(
    () => summarizeFatPct(windowBody(view, zoom.selection)),
    [view, zoom.selection],
  );
  if (!hasFatPct(series)) return null;

  return (
    <HealthChart
      title="Body fat"
      description="Body fat as a share of weight, from the smart scale. Different from the kilograms below: it can hold steady while fat falls and muscle grows."
      option={option}
      days={view.days}
      resolution="day"
      zoom={zoom}
      stats={stats}
    />
  );
}
