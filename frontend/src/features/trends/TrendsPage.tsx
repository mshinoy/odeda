import { useAggregate, useAggregateFilters } from "@/api/queries/useAggregate";
import { useBody } from "@/api/queries/useBody";
import { usePerformance } from "@/api/queries/usePerformance";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { AggregatePanel } from "@/features/trends/AggregatePanel";
import { BodyPerformancePanel } from "@/features/trends/BodyPerformancePanel";
import { DistributionsPanel } from "@/features/trends/DistributionsPanel";
import { PerformancePanel } from "@/features/trends/PerformancePanel";
import { RecordsPanel } from "@/features/trends/RecordsPanel";
import { TrendsFilterBar } from "@/features/trends/TrendsFilterBar";
import { TrendsPageSkeleton } from "@/features/trends/TrendsPageSkeleton";
import { hasFilters, NO_FILTERS, toAggregateParams } from "@/features/trends/trendsFilters";
import { useTrendsFilters } from "@/features/trends/useTrendsFilters";

/**
 * How far back the bodyweight charts look. Fixed rather than filtered, for the same
 * reason the performance block is: these read `/api/body`, which takes a window and
 * nothing else, and pretending the filter bar reached them would be a lie about what
 * is on screen.
 */
const BODY_WINDOW_DAYS = 730;

/** What you have done, the shape of it, and how well you have been doing it. */
export function TrendsPage() {
  const { filters, update } = useTrendsFilters();
  const aggregate = useAggregate(toAggregateParams(filters));
  const options = useAggregateFilters();
  const performance = usePerformance();
  const body = useBody(BODY_WINDOW_DAYS);

  if (aggregate.isPending || performance.isPending || body.isPending) return <TrendsPageSkeleton />;
  if (aggregate.error) return <EmptyState message={aggregate.error.message} />;
  if (performance.error) return <EmptyState message={performance.error.message} />;
  if (body.error) return <EmptyState message={body.error.message} />;

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

      {body.data.has_data && (
        <section className="flex flex-col gap-2">
          <h2 className="text-muted-foreground flex items-baseline gap-2 text-xs">
            Bodyweight and performance
            {filtered && <span>everything, not filtered</span>}
          </h2>
          <BodyPerformancePanel body={body.data} />
        </section>
      )}
    </div>
  );
}
