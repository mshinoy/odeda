// The lifetime totals, already formatted. Pure, so the cards below hold no logic and
// every unit is decided in one readable list.
import type { LifetimeTotals } from "@/api/queries/useAggregate";
import {
  formatDecimal,
  formatDistance,
  formatElevation,
  formatHeartRate,
  formatHours,
  formatInteger,
  formatPace,
} from "@/lib/format";

export interface TotalCard {
  label: string;
  value: string;
  /** The rate or the caveat the number needs, or null when it needs neither. */
  note: string | null;
}

/**
 * Six cards, in reading order: how often, how far, how long, how fast, how hard, how
 * high. A lifetime has nothing to be compared against, so where a card would carry a
 * delta it carries the rate behind its own number instead.
 *
 * Average pace is the awkward one. Across running, cycling and swimming a single
 * minutes-per-kilometre figure means nothing, so with no sport chosen the card says so
 * rather than implying otherwise. Pick a type in the filter bar and the caveat goes,
 * because then it is a real pace: 8:31 /km over every run, not 17:35 over everything.
 */
export function toTotalCards(
  totals: LifetimeTotals,
  { oneSport = false }: { oneSport?: boolean } = {},
): TotalCard[] {
  return [
    {
      label: "Activities",
      value: formatInteger(totals.activities),
      note: totals.span_years
        ? `${formatDecimal(totals.activities_per_week)} a week over ` +
          `${formatDecimal(totals.span_years)} years`
        : null,
    },
    {
      label: "Distance",
      value: formatDistance(totals.distance_m),
      note: totals.span_years ? `${formatDecimal(totals.distance_km_per_week)} km a week` : null,
    },
    {
      label: "Moving time",
      value: formatHours(totals.moving_time_s),
      note: null,
    },
    {
      label: "Average pace",
      value: formatPace(totals.avg_pace_s_per_km),
      note: oneSport || totals.avg_pace_s_per_km === null ? null : "mixed sports",
    },
    { label: "Average HR", value: formatHeartRate(totals.avg_hr), note: null },
    { label: "Elevation", value: formatElevation(totals.elevation_gain_m), note: null },
  ];
}
