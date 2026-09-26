import { useAggregate } from "@/api/queries/useAggregate";
import { usePerformance } from "@/api/queries/usePerformance";
import { EmptyState } from "@/components/EmptyState";
import { AggregatePanel } from "@/features/trends/AggregatePanel";
import { DistributionsPanel } from "@/features/trends/DistributionsPanel";
import { PerformancePanel } from "@/features/trends/PerformancePanel";
import { TrendsPageSkeleton } from "@/features/trends/TrendsPageSkeleton";

/** How your running has changed over the years you have recorded. */
export function TrendsPage() {
  const aggregate = useAggregate();
  const performance = usePerformance();

  if (aggregate.isPending || performance.isPending) return <TrendsPageSkeleton />;
  if (aggregate.error) return <EmptyState message={aggregate.error.message} />;
  if (performance.error) return <EmptyState message={performance.error.message} />;

  return (
    <div className="flex flex-col gap-12">
      {/* What you have done, the shape of it, then how well you have been doing it. */}
      <AggregatePanel aggregate={aggregate.data} />
      <DistributionsPanel
        distributions={aggregate.data.distributions}
        patterns={aggregate.data.patterns}
        totalMovingTimeS={aggregate.data.totals.moving_time_s}
      />
      <PerformancePanel performance={performance.data} />
    </div>
  );
}
