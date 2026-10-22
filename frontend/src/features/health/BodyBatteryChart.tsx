import { useMemo } from "react";
import type { DailyRow } from "@/api/queries/useHealth";
import { bodyBatteryDays, buildBodyBatteryOption } from "@/charts/health/buildBodyBatteryOption";
import { summarizeBodyBattery } from "@/charts/health/rangeStats";
import { resolutionFor, resolveRows } from "@/charts/health/resolution";
import { windowRows } from "@/charts/health/windowData";
import { useTokens } from "@/design/theme";
import { HealthChart } from "@/features/health/HealthChart";
import { useChartZoom, zoomKey } from "@/features/health/useChartZoom";

/** How far the battery charged and how far it ran down, each day. */
export function BodyBatteryChart({ rows }: { rows: readonly DailyRow[] }) {
  const tokens = useTokens();
  const zoom = useChartZoom(zoomKey(rows.map((row) => row.day)));
  const view = useMemo(() => windowRows(rows, zoom.zoom), [rows, zoom.zoom]);
  const resolution = resolutionFor(view.length);
  const drawn = useMemo(() => resolveRows(view, resolution), [view, resolution]);
  const option = useMemo(
    () => buildBodyBatteryOption({ rows: drawn, tokens, resolution }),
    [drawn, tokens, resolution],
  );
  const stats = useMemo(
    () => summarizeBodyBattery(windowRows(view, zoom.selection)),
    [view, zoom.selection],
  );

  if (!bodyBatteryDays(rows)) return null;

  return (
    <HealthChart
      title="Body Battery"
      description="How high the battery charged overnight and how low it ran down by evening. A wide gap means a demanding day."
      option={option}
      days={drawn.map((row) => row.day)}
      resolution={resolution}
      zoom={zoom}
      stats={stats}
    />
  );
}
