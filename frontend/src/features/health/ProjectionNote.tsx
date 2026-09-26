import type { RaceWeightProjection } from "@/api/queries/useBody";
import { projectionSentences } from "@/features/health/projectionNote";

/**
 * One line saying what the race-day card is, and one saying what the pace figure is not.
 *
 * The second sentence is not decoration. ~2 s per mile per pound is a rough empirical
 * average across runners that assumes the weight lost is fat; presenting the seconds it
 * produces without that sentence would turn a heuristic into a forecast, which is the
 * one thing this section is not allowed to do.
 */
export function ProjectionNote({ projection }: { projection: RaceWeightProjection }) {
  const [basis, ruleOfThumb] = projectionSentences(projection);

  return (
    <p className="text-muted-foreground text-xs">
      {basis} {ruleOfThumb}
    </p>
  );
}
