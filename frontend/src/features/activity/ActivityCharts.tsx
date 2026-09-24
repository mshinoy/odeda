import { useCallback, useMemo } from "react";
import type { Activity, ActivityStreams } from "@/api/adapters";
import { buildStreamChartOption } from "@/charts/streamChart/buildStreamChartOption";
import { StreamChart } from "@/charts/streamChart/StreamChart";
import { streamXAxis } from "@/charts/streamChart/streamXAxis";
import { EmptyState } from "@/components/EmptyState";
import { useTokens } from "@/design/theme";
import { availableMetrics, type MetricDefinition, type MetricKey } from "@/lib/metrics";
import { useUiStore } from "@/store/ui";

// Grade is left out here: next to elevation it mostly repeats it, only noisier.
const CHARTED_METRICS: readonly MetricKey[] = ["pace", "hr", "elevation"];

const CHART_HEIGHT = 150;

/** The charted metrics with at least one value to plot, in display order. */
function chartedMetrics(streams: ActivityStreams): MetricDefinition[] {
  return availableMetrics(streams).filter(
    (metric) =>
      CHARTED_METRICS.includes(metric.key) && metric.plotValues(streams).some((v) => v !== null),
  );
}

/** One chart per metric, stacked on a shared x-axis, with one crosshair shared with the map. */
export function ActivityCharts({ activity }: { activity: Activity }) {
  const { streams, summary } = activity;
  const activityId = summary.id;
  const tokens = useTokens();
  const setHover = useUiStore((state) => state.setHover);
  const clearHover = useUiStore((state) => state.clearHover);
  // A number, not the hover object, so hovering another activity does not re-render this one.
  const hoverIndex = useUiStore((state) =>
    state.hover?.activityId === activityId ? state.hover.index : null,
  );

  const xValues = useMemo(() => streamXAxis(streams).values, [streams]);

  // Built once per data and theme; hover only moves the crosshair.
  const charts = useMemo(() => {
    const metrics = chartedMetrics(streams);
    return metrics.map((metric, i) => ({
      metric,
      option: buildStreamChartOption({
        streams,
        metric,
        kind: summary.kind,
        tokens,
        showXAxisLabels: i === metrics.length - 1,
      }),
    }));
  }, [streams, summary.kind, tokens]);

  const onHoverIndex = useCallback(
    (index: number | null) => {
      if (index === null) {
        clearHover();
      } else {
        setHover({ activityId, index });
      }
    },
    [activityId, setHover, clearHover],
  );

  if (charts.length === 0) return <EmptyState message="No heart rate, pace or elevation data." />;

  return (
    <section aria-label="Activity charts" className="flex flex-col gap-3">
      {charts.map(({ metric, option }) => (
        <StreamChart
          key={metric.key}
          label={metric.label}
          option={option}
          xValues={xValues}
          height={CHART_HEIGHT}
          hoverIndex={hoverIndex}
          onHoverIndex={onHoverIndex}
        />
      ))}
    </section>
  );
}
