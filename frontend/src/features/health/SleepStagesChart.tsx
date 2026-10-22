import { useMemo } from "react";
import type { DailyRow } from "@/api/queries/useHealth";
import { buildSleepStagesOption } from "@/charts/health/buildSleepStagesOption";
import { summarizeSleep } from "@/charts/health/rangeStats";
import { resolutionFor, resolveRows } from "@/charts/health/resolution";
import { windowRows } from "@/charts/health/windowData";
import { useTokens } from "@/design/theme";
import { HealthChart } from "@/features/health/HealthChart";
import { SleepStageLegend } from "@/features/health/SleepStageLegend";
import { hasSleepStages, sleepNights } from "@/features/health/sleepStages";
import { useChartZoom, zoomKey } from "@/features/health/useChartZoom";

const SLEEP_CHART_HEIGHT = 340;

/** The page's hero: what each night was made of, one stacked bar a night (a week's average past a quarter). */
export function SleepStagesChart({ rows }: { rows: readonly DailyRow[] }) {
  const tokens = useTokens();
  const zoom = useChartZoom(zoomKey(rows.map((row) => row.day)));
  const view = useMemo(() => windowRows(rows, zoom.zoom), [rows, zoom.zoom]);
  const resolution = resolutionFor(view.length);
  const nights = useMemo(() => sleepNights(resolveRows(view, resolution)), [view, resolution]);
  const option = useMemo(
    () => buildSleepStagesOption({ nights, tokens, resolution }),
    [nights, tokens, resolution],
  );
  const stats = useMemo(
    () => summarizeSleep(windowRows(view, zoom.selection)),
    [view, zoom.selection],
  );

  // Judged on the whole range, so zooming into a stretch with no stages keeps the chart.
  if (!hasSleepStages(sleepNights(rows))) return null;

  return (
    <HealthChart
      title="Sleep stages"
      description="Each night's sleep split into deep, REM and light. Past a quarter, each bar is a week's average."
      option={option}
      days={nights.map((night) => night.day)}
      resolution={resolution}
      zoom={zoom}
      stats={stats}
      height={SLEEP_CHART_HEIGHT}
      legend={<SleepStageLegend />}
    />
  );
}
