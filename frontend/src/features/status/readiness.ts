import type { components } from "@/api/schema";

type Readiness = components["schemas"]["Readiness"];
export type ReadinessBand = NonNullable<Readiness["band"]>;
export type Tone = "good" | "warning" | "serious" | "critical";

/** Band name as shown, and the status tone its dot takes. */
export const bandDisplay: Record<ReadinessBand, { label: string; tone: Tone }> = {
  prime: { label: "Prime", tone: "good" },
  ready: { label: "Ready", tone: "good" },
  moderate: { label: "Moderate", tone: "warning" },
  low: { label: "Low", tone: "serious" },
  rest: { label: "Rest", tone: "critical" },
};

export interface ReadinessPart {
  label: string;
  /** 0-100, higher is better; null when that input had no data today. */
  score: number | null;
}

/** The four inputs of the readiness score, in a fixed order with 1-2 word labels. */
export function readinessParts(readiness: Readiness): ReadinessPart[] {
  const c = readiness.components;
  return [
    { label: "Sleep", score: c.sleep ?? null },
    { label: "HRV", score: c.hrv ?? null },
    { label: "Form", score: c.tsb ?? null },
    { label: "Resting HR", score: c.rhr ?? null },
  ];
}

/** Bar width for a 0-100 score, clamped. */
export function scoreWidthPct(score: number | null): number {
  if (score === null) return 0;
  return Math.min(Math.max(score, 0), 100);
}
