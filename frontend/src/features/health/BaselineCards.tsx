import type { Trends } from "@/api/queries/useHealth";
import { StatCard } from "@/components/StatCard";
import { baselineCard, CARD_METRICS, recordedMetrics } from "@/features/health/healthMetrics";

/**
 * Where each metric stands today against its own baseline. A card takes a tone only
 * when the backend flagged the deviation, which is what makes the row scannable: on a
 * normal day it is all neutral.
 */
export function BaselineCards({ trends }: { trends: Trends }) {
  const cards = recordedMetrics(CARD_METRICS, trends).map(({ metric, trend }) =>
    baselineCard(metric, trend),
  );
  if (cards.length === 0) return null;

  return (
    <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-5">
      {cards.map((card) => (
        <StatCard
          key={card.label}
          label={card.label}
          value={card.value}
          delta={card.delta ?? undefined}
          deltaTone={card.tone}
        />
      ))}
    </div>
  );
}
