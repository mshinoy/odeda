import { useMemo } from "react";
import type { Aggregate } from "@/api/queries/useAggregate";
import { EmptyState } from "@/components/EmptyState";
import { MonthlyDistanceChart } from "@/features/trends/MonthlyDistanceChart";
import { TotalsPanel } from "@/features/trends/TotalsPanel";
import { toYearTableRows } from "@/features/trends/yearRow";
import { YearOverYearTable } from "@/features/trends/YearOverYearTable";

/** What you have done: the lifetime totals, the months behind them, and each year
 * against the one before. */
export function AggregatePanel({ aggregate }: { aggregate: Aggregate }) {
  const yearRows = useMemo(
    () => toYearTableRows(aggregate.year_over_year.years),
    [aggregate.year_over_year.years],
  );

  if (aggregate.totals.activities === 0) {
    return <EmptyState message="No activities recorded yet." />;
  }

  return (
    <div className="flex flex-col gap-12">
      <TotalsPanel totals={aggregate.totals} />

      <figure className="flex flex-col gap-1">
        <figcaption className="text-muted-foreground text-xs">Distance by month</figcaption>
        <MonthlyDistanceChart months={aggregate.by_month} />
      </figure>

      {yearRows.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-muted-foreground text-xs">Year over year</h2>
          <YearOverYearTable rows={yearRows} />
        </section>
      )}
    </div>
  );
}
