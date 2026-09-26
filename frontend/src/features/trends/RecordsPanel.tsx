import { useMemo } from "react";
import type { AggregateStreaks, Records } from "@/api/queries/useAggregate";
import { StatCard } from "@/components/StatCard";
import { ExtremesTable } from "@/features/trends/ExtremesTable";
import { toExtremeRows, toStreakCards } from "@/features/trends/records";

interface RecordsPanelProps {
  streaks: AggregateStreaks;
  records: Records;
}

/** How consistent you have been, and the sessions that top everything else. */
export function RecordsPanel({ streaks, records }: RecordsPanelProps) {
  const cards = useMemo(() => toStreakCards(streaks), [streaks]);
  const rows = useMemo(() => toExtremeRows(records.extremes), [records.extremes]);

  return (
    <div className="flex flex-col gap-12">
      <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
        {cards.map((card) => (
          <StatCard
            key={card.label}
            label={card.label}
            value={card.value}
            delta={card.note ?? undefined}
          />
        ))}
      </div>

      {rows.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-muted-foreground text-xs">Records</h2>
          <ExtremesTable rows={rows} />
        </section>
      )}
    </div>
  );
}
