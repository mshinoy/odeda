// The four numbers above the body-composition charts, derived in one place so a card
// and the chart under it can never disagree about a unit or a sign.
//
// The first card is the *trend*, not the last reading, and that is the point of the
// whole section: the reading is in its own caption, small, because a single morning is
// not news. Everything with a direction takes a tone — fat down is good, lean down is
// not, and a scale that has not been stood on in a week is worth saying out loud.
import type { BodyConsistency, BodyLatest, RaceWeightProjection } from "@/api/queries/useBody";
import { formatDays, formatDecimal, formatSigned, formatWithUnit, MISSING } from "@/lib/format";

export type CardTone = "good" | "bad" | "neutral";

export interface BodyCard {
  label: string;
  value: string;
  delta?: string;
  tone: CardTone;
}

/** Weighing in this rarely makes every trend on the page thin, so the card says so. */
export const STALE_AFTER_DAYS = 7;

/** Fewer than this in a week and the trend is being carried by very little. */
export const THIN_PER_WEEK = 2;

function tone(change: number | null | undefined, goodWhenNegative: boolean): CardTone {
  if (change === null || change === undefined || Math.abs(change) < 0.05) return "neutral";
  return change < 0 === goodWhenNegative ? "good" : "bad";
}

/** Current trend weight, with the latest actual reading beside it as the lesser fact. */
export function weightCard(latest: BodyLatest): BodyCard {
  return {
    label: "Weight trend",
    value: formatWithUnit(latest.trend_kg, "kg", 1),
    delta:
      latest.reading_kg === null || latest.reading_kg === undefined
        ? undefined
        : `last reading ${formatDecimal(latest.reading_kg, 1)}`,
    // The reading is context, not a verdict: it never colours the card.
    tone: "neutral",
  };
}

/** Where the weight has gone over the window drawn, so the card matches the chart. */
export function changeCard(latest: BodyLatest): BodyCard {
  return {
    label: "Over this window",
    value:
      latest.change_kg === null || latest.change_kg === undefined
        ? MISSING
        : `${formatSigned(latest.change_kg, 1)} kg`,
    tone: tone(latest.change_kg, true),
  };
}

/**
 * Fat mass, and how it has moved — which is the number the scale hides.
 *
 * Returns null when no body-fat reading exists: a manual weight entry has none, and a
 * card reading "– kg" teaches nothing that hiding it does not.
 */
export function fatCard(latest: BodyLatest): BodyCard | null {
  if (latest.fat_kg === null || latest.fat_kg === undefined) return null;
  return {
    label: "Fat mass",
    value: formatWithUnit(latest.fat_kg, "kg", 1),
    delta:
      latest.fat_change_kg === null || latest.fat_change_kg === undefined
        ? undefined
        : `${formatSigned(latest.fat_change_kg, 1)} kg`,
    tone: tone(latest.fat_change_kg, true),
  };
}

/** Lean mass. The same numbers as `fatCard` with the sign read the other way round. */
export function leanCard(latest: BodyLatest): BodyCard | null {
  if (latest.lean_kg === null || latest.lean_kg === undefined) return null;
  return {
    label: "Lean mass",
    value: formatWithUnit(latest.lean_kg, "kg", 1),
    delta:
      latest.lean_change_kg === null || latest.lean_change_kg === undefined
        ? undefined
        : `${formatSigned(latest.lean_change_kg, 1)} kg`,
    tone: tone(latest.lean_change_kg, false),
  };
}

/** How often the scale is used, flagged when it is thin or when it has gone quiet. */
export function consistencyCard(consistency: BodyConsistency): BodyCard {
  const stale =
    consistency.days_since_last !== null &&
    consistency.days_since_last !== undefined &&
    consistency.days_since_last > STALE_AFTER_DAYS;
  return {
    label: "Weigh-ins",
    value: `${formatDecimal(consistency.per_week, 1)} / week`,
    delta: stale
      ? `none for ${formatDays(consistency.days_since_last)}`
      : `${formatDecimal(consistency.coverage_pct, 0)}% of days`,
    tone: stale || consistency.per_week < THIN_PER_WEEK ? "bad" : "neutral",
  };
}

/**
 * Projected race-day weight.
 *
 * The delta carries the window the line was fitted over rather than the rule-of-thumb
 * seconds: a card is one number and a label (Rules), and a time estimate on a card is
 * the fastest way for a heuristic to be read as a forecast. It is shown in the
 * projection's own note instead, next to the words that qualify it.
 */
export function projectionCard(projection: RaceWeightProjection): BodyCard {
  return {
    label: "Race day",
    value: formatWithUnit(projection.projected_kg, "kg", 1),
    delta: `${formatSigned(projection.change_kg, 1)} kg in ${formatDays(projection.days_out)}`,
    tone: "neutral",
  };
}

/** Every card the section shows, in the order the row reads them. */
export function bodyCards(
  latest: BodyLatest | null | undefined,
  consistency: BodyConsistency,
  projection: RaceWeightProjection | null | undefined,
): BodyCard[] {
  if (!latest) return [];
  const cards: (BodyCard | null)[] = [
    weightCard(latest),
    changeCard(latest),
    fatCard(latest),
    leanCard(latest),
    consistencyCard(consistency),
    projection ? projectionCard(projection) : null,
  ];
  return cards.filter((card): card is BodyCard => card !== null);
}
