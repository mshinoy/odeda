import type { BodyComposition } from "@/api/queries/useBody";
import { StatCard } from "@/components/StatCard";
import { bodyCards } from "@/features/health/bodyCards";
import { MassSplitChart } from "@/features/health/MassSplitChart";
import { ProjectionNote } from "@/features/health/ProjectionNote";
import { WeightTrendChart } from "@/features/health/WeightTrendChart";

/**
 * Body composition, where the rest of the daily measurements are.
 *
 * It hides itself entirely when nothing has ever been weighed, rather than drawing an
 * empty chart: until the Fitbit account is connected that is the true state of things,
 * and an empty axis would suggest otherwise.
 */
export function BodyPanel({ body }: { body: BodyComposition }) {
  if (!body.has_data) return null;
  const cards = bodyCards(body.latest, body.consistency, body.projection);

  return (
    <section className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-6">
        {cards.map((card) => (
          <StatCard
            key={card.label}
            label={card.label}
            value={card.value}
            delta={card.delta}
            deltaTone={card.tone}
          />
        ))}
      </div>
      <div className="grid gap-8 lg:grid-cols-2">
        <WeightTrendChart series={body.series} />
        <MassSplitChart series={body.series} />
      </div>
      {body.projection && <ProjectionNote projection={body.projection} />}
    </section>
  );
}
