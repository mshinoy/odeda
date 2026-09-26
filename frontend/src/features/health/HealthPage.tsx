import { useBody } from "@/api/queries/useBody";
import { useDaily, useReadinessHistory, useTrends } from "@/api/queries/useHealth";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/EmptyState";
import { BaselineCards } from "@/features/health/BaselineCards";
import { BodyPanel } from "@/features/health/BodyPanel";
import { BodyBatteryChart } from "@/features/health/BodyBatteryChart";
import {
  CARD_METRICS,
  CHART_METRICS,
  missingMetrics,
  recordedMetrics,
} from "@/features/health/healthMetrics";
import { HealthPageSkeleton } from "@/features/health/HealthPageSkeleton";
import { MetricTrendChart } from "@/features/health/MetricTrendChart";
import { RangeToggle } from "@/features/health/RangeToggle";
import { ReadinessChart } from "@/features/health/ReadinessChart";
import { SleepStagesChart } from "@/features/health/SleepStagesChart";
import { HEALTH_RANGES } from "@/features/health/healthRange";
import { useHealthRange } from "@/features/health/useHealthRange";

const WIDEST_RANGE = HEALTH_RANGES[HEALTH_RANGES.length - 1] ?? HEALTH_RANGES[0];

/**
 * Sleep, HRV, resting heart rate and Body Battery, each against its own baseline — and
 * body composition, which belongs here for the same reason: it is a daily measurement
 * of the athlete rather than of a session.
 */
export function HealthPage() {
  const { days, setDays } = useHealthRange();
  const trends = useTrends(days);
  const daily = useDaily(days);
  const readiness = useReadinessHistory(days);
  const body = useBody(days);

  if (trends.isPending || daily.isPending || readiness.isPending || body.isPending)
    return <HealthPageSkeleton />;
  if (trends.error) return <EmptyState message={trends.error.message} />;
  if (daily.error) return <EmptyState message={daily.error.message} />;
  if (readiness.error) return <EmptyState message={readiness.error.message} />;
  if (body.error) return <EmptyState message={body.error.message} />;

  const charted = recordedMetrics(CHART_METRICS, trends.data);
  const missing = missingMetrics(CARD_METRICS, trends.data);
  // Weighing in is recording something, even when the watch was in a drawer all month.
  const nothingRecorded = missing.length === CARD_METRICS.length && !body.data.has_data;

  return (
    <div className="flex flex-col gap-10">
      <RangeToggle value={days} onChange={setDays} />

      {nothingRecorded ? (
        <EmptyState
          message="Nothing was recorded in this range."
          action={
            <Button variant="outline" size="sm" onClick={() => setDays(WIDEST_RANGE)}>
              Widen the range
            </Button>
          }
        />
      ) : (
        <>
          <BaselineCards trends={trends.data} />
          <BodyPanel body={body.data} />
          <SleepStagesChart rows={daily.data.rows} />
          <div className="grid gap-8 lg:grid-cols-2">
            {charted.map(({ metric, trend }) => (
              <MetricTrendChart key={metric.key} metric={metric} trend={trend} />
            ))}
            <BodyBatteryChart rows={daily.data.rows} />
          </div>
          <ReadinessChart series={readiness.data.series} />
          {missing.length > 0 && (
            <p className="text-muted-foreground text-xs">
              Not recorded in this range: {missing.map((metric) => metric.label).join(", ")}.
            </p>
          )}
        </>
      )}
    </div>
  );
}
