import type { components } from "@/api/schema";

type SummaryRace = components["schemas"]["SummaryRace"];

/** Seconds per km for a projected finish over the race distance. */
export function projectedPace(race: SummaryRace): number | null {
  const projection = race.projection;
  // A calendar race need not name a distance (T57), and without one there is no pace.
  if (!projection || race.distance_m === null || race.distance_m <= 0) return null;
  return projection.projected_seconds / (race.distance_m / 1000);
}
