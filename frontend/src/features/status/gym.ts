import type { components } from "@/api/schema";
import { formatDelta, formatInteger } from "@/lib/format";

type GymThisWeek = components["schemas"]["GymThisWeek"];

export interface GymCard {
  label: string;
  value: string;
  /** Against the four weeks before; left out when they held no gym session. */
  delta?: string;
}

/** This week's gym sessions and sets, each against the four-week average. */
export function gymCards(gym: GymThisWeek): GymCard[] {
  return [
    card("Gym sessions", gym.sessions, gym.sessions_delta_pct),
    card("Gym sets", gym.sets, gym.sets_delta_pct),
  ];
}

function card(label: string, value: number, deltaPct: number | null): GymCard {
  const result: GymCard = { label, value: formatInteger(value) };
  if (deltaPct !== null) result.delta = `${formatDelta(deltaPct)} vs 4-wk avg`;
  return result;
}
