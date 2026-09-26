import { useAggregate, useAggregateFilters } from "@/api/queries/useAggregate";
import { usePerformance } from "@/api/queries/usePerformance";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { AggregatePanel } from "@/features/trends/AggregatePanel";
import { DistributionsPanel } from "@/features/trends/DistributionsPanel";
import { PerformancePanel } from "@/features/trends/PerformancePanel";
import { RecordsPanel } from "@/features/trends/RecordsPanel";
import { TrendsFilterBar } from "@/features/trends/TrendsFilterBar";
import { TrendsPageSkeleton } from "@/features/trends/TrendsPageSkeleton";
import { hasFilters, NO_FILTERS, toAggregateParams } from "@/features/trends/trendsFilters";
import { useTrendsFilters } from "@/features/trends/useTrendsFilters";

/** What you have done, the shape of it, and how well you have been doing it. */
export function TrendsPage() {
  const { filters, update } = useTrendsFilters();
  const aggregate = useAggregate(toAggregateParams(filters));
  const options = useAggregateFilters();
  const performance = usePerformance();

  if (aggregate.isPending || performance.isPending) return <TrendsPageSkeleton />;
  if (aggregate.error) return <EmptyState message={aggregate.error.message} />;
  if (performance.error) return <EmptyState message={performance.error.message} />;

  const filtered = hasFilters(filters);
  const nothingMatches = aggregate.data.totals.activities === 0;

  return (
    <div className="flex flex-col gap-12">
      <TrendsFilterBar
        filters={filters}
        types={options.data?.types.map((type) => type.value) ?? []}
        gear={options.data?.gear ?? []}
        onChange={update}
      />

      {nothingMatches ? (
        <EmptyState
          message="No activities match those filters."
          action={
            <Button variant="outline" size="sm" onClick={() => update(NO_FILTERS)}>
              Clear filters
            </Button>
          }
        />
      ) : (
        <>
          <AggregatePanel aggregate={aggregate.data} />
          <DistributionsPanel
            distributions={aggregate.data.distributions}
            patterns={aggregate.data.patterns}
            totalMovingTimeS={aggregate.data.totals.moving_time_s}
          />
          <RecordsPanel streaks={aggregate.data.streaks} records={aggregate.data.records} />
        </>
      )}

      {/*
        The filter bar stops here. `/api/performance` takes no parameters, and giving it
        any means teaching `analytics/performance` to filter, which is not a view's
        decision to make. The block says so rather than looking as if it had answered.
      */}
      <section className="flex flex-col gap-2">
        <h2 className="text-muted-foreground flex items-baseline gap-2 text-xs">
          Running performance
          {filtered && <span>all running, not filtered</span>}
        </h2>
        <PerformancePanel performance={performance.data} />
      </section>
    </div>
  );
}
