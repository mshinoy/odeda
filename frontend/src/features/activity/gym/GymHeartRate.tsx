import { useMemo } from "react";
import type { Activity } from "@/api/adapters";
import { buildStreamChartOption } from "@/charts/streamChart/buildStreamChartOption";
import { StreamChart } from "@/charts/streamChart/StreamChart";
import { streamXAxis } from "@/charts/streamChart/streamXAxis";
import { useTokens } from "@/design/theme";
import { metrics } from "@/lib/metrics";

const NO_HOVER = (): void => undefined;

/** The heart rate across the session, in a popup: the gym floor has no map to share it with. */
export function GymHeartRate({ activity }: { activity: Activity }) {
  const tokens = useTokens();
  const { streams, summary } = activity;
  const xValues = useMemo(() => streamXAxis(streams).values, [streams]);
  const option = useMemo(
    () => buildStreamChartOption({ streams, metric: metrics.hr, kind: summary.kind, tokens }),
    [streams, summary.kind, tokens],
  );
  return (
    <StreamChart
      label="Heart rate"
      option={option}
      xValues={xValues}
      height={180}
      hoverIndex={null}
      onHoverIndex={NO_HOVER}
    />
  );
}
