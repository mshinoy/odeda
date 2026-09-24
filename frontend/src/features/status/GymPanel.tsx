import type { Summary } from "@/api/queries/useStatus";
import { StatCard } from "@/components/StatCard";
import { gymCards } from "@/features/status/gym";

type GymThisWeek = NonNullable<Summary["gym"]>;

/** Gym sessions and sets this week, on the same three-column grid as the load cards. */
export function GymPanel({ gym }: { gym: GymThisWeek }) {
  return (
    <section aria-label="Gym this week" className="grid grid-cols-3 gap-6">
      {gymCards(gym).map((card) => (
        <StatCard key={card.label} label={card.label} value={card.value} delta={card.delta} />
      ))}
    </section>
  );
}
