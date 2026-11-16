import { useCallback, useMemo, useState } from "react";
import type { ComparedAttempt } from "@/api/adapters";
import {
  buildCompareChartOption,
  compareKind,
  compareXAxis,
  type CompareSeries,
} from "@/charts/compareChart/buildCompareChartOption";
import { EChart } from "@/charts/EChart";
import { EmptyState } from "@/components/EmptyState";
import { useTokens } from "@/design/theme";
import { metricLabel, metrics, type MetricKey } from "@/lib/metrics";

// Pace and heart rate answer "who was faster, and at what cost". Elevation is the same
// hill for everyone on the same route, so it says nothing here.
const CHARTED: readonly MetricKey[] = ["pace", "hr"];

const CHART_HEIGHT = 170;

/** Pace and HR for every compared activity, on one shared axis and one crosshair. */
export function CompareCharts({ attempts }: { attempts: readonly ComparedAttempt[] }) {
  const tokens = useTokens();
  // Every activity is plotted on one grid of x values, so the crosshair is one index
  // into that grid and means the same distance on each chart.
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const series: CompareSeries[] = useMemo(
    () =>
      attempts.map((attempt, i) => ({
        id: attempt.activity.id,
        label: attempt.activity.name.trim() || attempt.activity.day,
        color: tokens.series[i % tokens.series.length] ?? tokens.inkMuted,
        streams: attempt.streams,
        kind: attempt.activity.kind,
      })),
    [attempts, tokens],
  );

  const xAxis = useMemo(() => compareXAxis(series), [series]);
  const charts = useMemo(
    () =>
      CHARTED.map((key, i) => ({
        key,
        label: metricLabel(metrics[key], compareKind(series)),
        option: buildCompareChartOption({
          series,
          metric: metrics[key],
          tokens,
          showXAxisLabels: i === CHARTED.length - 1,
        }),
      })),
    [series, tokens],
  );

  const onHoverIndex = useCallback((index: number | null) => setHoverIndex(index), []);

  if (series.length === 0) return <EmptyState message="Nothing to compare." />;

  return (
    <div role="group" aria-label="Compared charts" className="flex flex-col gap-3">
      {charts.map((chart) => (
        <figure key={chart.key} className="flex flex-col gap-1">
          <figcaption className="text-muted-foreground text-xs">{chart.label}</figcaption>
          <EChart
            option={chart.option}
            height={CHART_HEIGHT}
            xValues={xAxis.grid}
            hoverIndex={hoverIndex}
            onHoverIndex={onHoverIndex}
          />
        </figure>
      ))}
    </div>
  );
}
