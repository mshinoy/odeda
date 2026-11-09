import { useCallback, useMemo } from "react";
import { withPaceWindow, type Activity } from "@/api/adapters";
import { buildStreamChartOption } from "@/charts/streamChart/buildStreamChartOption";
import { StreamChart } from "@/charts/streamChart/StreamChart";
import { streamXAxis } from "@/charts/streamChart/streamXAxis";
import { useTokens } from "@/design/theme";
import { MetricToggle } from "@/features/activity/MetricToggle";
import { availableMetrics, metricLabel, type MetricKey, metrics } from "@/lib/metrics";
import { useUiStore } from "@/store/ui";

/**
 * Pace is averaged over three minutes here. A run and walk session turns over every couple of
 * minutes, and anything shorter draws that rhythm instead of the run.
 */
const PACE_WINDOW_S = 180;
const CHART_HEIGHT = 200;

interface AlongTheRunProps {
  activity: Activity;
  colorBy: MetricKey;
  onColorBy: (key: MetricKey) => void;
}

/**
 * The whole activity as one line, whichever metric is chosen. The choice is the map's too,
 * so the route and the chart always tell the same story and there is one control, not two.
 * The crosshair is shared with the map as before.
 */
export function AlongTheRun({ activity, colorBy, onColorBy }: AlongTheRunProps) {
  const { streams, summary } = activity;
  const tokens = useTokens();
  const setHover = useUiStore((state) => state.setHover);
  const clearHover = useUiStore((state) => state.clearHover);
  const hoverIndex = useUiStore((state) =>
    state.hover?.activityId === summary.id ? state.hover.index : null,
  );

  const options = availableMetrics(streams);
  const metric = options.find((m) => m.key === colorBy) ?? options[0] ?? metrics.pace;
  const xValues = useMemo(() => streamXAxis(streams).values, [streams]);
  const calmed = useMemo(() => withPaceWindow(streams, PACE_WINDOW_S), [streams]);
  const option = useMemo(
    () =>
      buildStreamChartOption({
        streams: metric.key === "pace" ? calmed : streams,
        metric,
        kind: summary.kind,
        tokens,
      }),
    [calmed, streams, metric, summary.kind, tokens],
  );

  const onHoverIndex = useCallback(
    (index: number | null) => {
      if (index === null) clearHover();
      else setHover({ activityId: summary.id, index });
    },
    [summary.id, setHover, clearHover],
  );

  if (options.length === 0) return null;
  return (
    <section
      aria-label="Along the activity"
      className="bg-card shadow-card flex flex-col gap-2 rounded-2xl border p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h2 className="text-lg font-semibold">
            Along the {summary.kind === "ride" ? "ride" : "run"}
          </h2>
          <span className="text-muted-foreground text-xs">
            {metric.key === "pace" ? "Smoothed over three minutes. " : ""}The control colours the
            map too.
          </span>
        </div>
        <MetricToggle
          options={options}
          value={metric.key}
          kind={summary.kind}
          onChange={onColorBy}
          plain
        />
      </div>
      <StreamChart
        label={metricLabel(metric, summary.kind)}
        option={option}
        xValues={xValues}
        height={CHART_HEIGHT}
        hoverIndex={hoverIndex}
        onHoverIndex={onHoverIndex}
      />
    </section>
  );
}
