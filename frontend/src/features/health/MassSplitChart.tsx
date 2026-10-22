import { useMemo } from "react";
import type { BodySeries } from "@/api/queries/useBody";
import {
  buildMassSplitOption,
  hasSplit,
  MASS_SERIES,
  massColors,
} from "@/charts/body/buildMassSplitOption";
import { summarizeMass } from "@/charts/health/rangeStats";
import { windowBody } from "@/charts/health/windowData";
import { useTokens } from "@/design/theme";
import { HealthChart } from "@/features/health/HealthChart";
import { useChartZoom, zoomKey } from "@/features/health/useChartZoom";

/** Two lines in the same unit are not self-explanatory, so they carry a legend. */
function MassLegend() {
  const colors = massColors(useTokens());

  return (
    <span className="text-muted-foreground flex items-center gap-3 text-sm">
      {MASS_SERIES.map(({ label }) => (
        <span key={label} className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full" style={{ backgroundColor: colors[label] }} />
          {label}
        </span>
      ))}
    </span>
  );
}

/**
 * Fat mass against lean mass. Hidden when the scale never measured body fat, because
 * without it there is no split — only the weight line again, drawn twice.
 */
export function MassSplitChart({ series }: { series: BodySeries }) {
  const tokens = useTokens();
  const zoom = useChartZoom(zoomKey(series.days));
  const view = useMemo(() => windowBody(series, zoom.zoom), [series, zoom.zoom]);
  const option = useMemo(() => buildMassSplitOption({ series: view, tokens }), [view, tokens]);
  const stats = useMemo(
    () => summarizeMass(windowBody(view, zoom.selection)),
    [view, zoom.selection],
  );
  if (!hasSplit(series)) return null;

  return (
    <HealthChart
      title="Fat and lean mass, change"
      description="Kilograms of fat and of lean mass gained or lost since the start of the range. Fat falling while lean holds is the goal."
      option={option}
      days={view.days}
      resolution="day"
      zoom={zoom}
      stats={stats}
      legend={<MassLegend />}
    />
  );
}
