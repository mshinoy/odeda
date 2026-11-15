import { useAggregate, useAggregateFilters } from "@/api/queries/useAggregate";
import { useBody } from "@/api/queries/useBody";
import { usePerformance } from "@/api/queries/usePerformance";
import { SectionCard } from "@/components/SectionCard";
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
    <div className="flex flex-col gap-6">
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
          <SectionCard title="Volume" question="How much have I done, and is it growing?">
            <AggregatePanel aggregate={aggregate.data} />
          </SectionCard>
          <SectionCard title="Patterns" question="How hard, how fast and when do I train?">
            <DistributionsPanel
              distributions={aggregate.data.distributions}
              patterns={aggregate.data.patterns}
              totalMovingTimeS={aggregate.data.totals.moving_time_s}
            />
          </SectionCard>
          <SectionCard title="Records" question="What are my best efforts and longest streaks?">
            <RecordsPanel streaks={aggregate.data.streaks} records={aggregate.data.records} />
          </SectionCard>
        </>
      )}

      {/*
        The filter bar stops here. `/api/performance` takes no parameters, and giving it
        any means teaching `analytics/performance` to filter, which is not a view's
        decision to make. The block says so rather than looking as if it had answered.
      */}
      <SectionCard
        title="Running performance"
        question="Am I getting faster, and more efficient?"
        note={filtered ? "all running, not filtered" : undefined}
      >
        <PerformancePanel performance={performance.data} />
      </SectionCard>

      {body.data.has_data && (
        <SectionCard
          title="Bodyweight and performance"
          question="Does my weight move my running?"
          note={filtered ? "everything, not filtered" : undefined}
        >
          <BodyPerformancePanel body={body.data} />
        </SectionCard>
      )}
    </div>
  );
}
