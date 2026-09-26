import { useMemo } from "react";
import type { LifetimeTotals } from "@/api/queries/useAggregate";
import { StatCard } from "@/components/StatCard";
import { toTotalCards } from "@/features/trends/totalCards";

/** Everything you have recorded, in six numbers. */
export function TotalsPanel({ totals }: { totals: LifetimeTotals }) {
  const cards = useMemo(() => toTotalCards(totals), [totals]);

  return (
    <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-6">
      {cards.map((card) => (
        <StatCard
          key={card.label}
          label={card.label}
          value={card.value}
          delta={card.note ?? undefined}
        />
      ))}
    </div>
  );
}
