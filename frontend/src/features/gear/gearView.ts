import type { GearRecord } from "@/api/adapters";

/** How a gear item's wear reads: the label beside the bar, and how full it is. */
export interface Wear {
  /** 0–1, clamped: a bar cannot be more than full even when the mileage is. */
  fraction: number;
  state: GearRecord["state"];
  /** Null when the item has no retirement distance to be worn against. */
  pct: number | null;
}

export function wearOf(item: GearRecord): Wear {
  const pct = item.retirementPct;
  return {
    fraction: pct === null ? 0 : Math.min(Math.max(pct, 0), 100) / 100,
    state: item.state,
    pct,
  };
}

/** The one line under a card: what it is worn against, or that it is not. */
export type WearTone = "good" | "warning" | "critical" | "neutral";

export const wearTone: Record<GearRecord["state"], WearTone> = {
  ok: "good",
  warn: "warning",
  over: "critical",
  retired: "neutral",
};

export const wearLabel: Record<GearRecord["state"], string> = {
  ok: "In use",
  warn: "Near its limit",
  over: "Past its limit",
  retired: "Retired",
};

/**
 * Cards in the order they are worth looking at: the ones asking to be replaced
 * first, then the rest by mileage, with retired items last however far they ran.
 */
const STATE_ORDER: Record<GearRecord["state"], number> = {
  over: 0,
  warn: 1,
  ok: 2,
  retired: 3,
};

export function sortGear(gear: readonly GearRecord[]): GearRecord[] {
  return [...gear].sort(
    (a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] || b.totalDistanceM - a.totalDistanceM,
  );
}

export function visibleGear(gear: readonly GearRecord[], showRetired: boolean): GearRecord[] {
  return sortGear(showRetired ? gear : gear.filter((item) => !item.retired));
}
