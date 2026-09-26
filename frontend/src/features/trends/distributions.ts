// The three distributions the Trends page draws, described once: what each histogram's
// buckets are in, how a tick and a tooltip read them, and how many activities are
// actually behind the bars.
//
// `/api/aggregate` sends a bucket as `lo`, `hi` and `count` and nothing else — the
// label it used to render came off the same `lo`, and formatting belongs in format.ts.
// So every unit below is decided here, in one list, rather than on four axes.
import type { components } from "@/api/schema";
import {
  formatDuration,
  formatHeartRate,
  formatHours,
  formatInteger,
  formatPace,
  formatPaceClock,
} from "@/lib/format";

type HistogramBucket = components["schemas"]["HistogramBucket"];
type HrZoneShare = components["schemas"]["HrZoneShare"];

export interface HistogramSpec {
  /** 1-2 words above the chart. */
  label: string;
  /** An axis tick: the bucket's low edge, without a unit. */
  formatTick: (lo: number) => string;
  /** The range a bucket covers, with its unit, for the tooltip. */
  formatRange: (lo: number, hi: number) => string;
}

/** Seconds per kilometre, in 15-second buckets between 2:30 and 15:00. */
export const PACE_HISTOGRAM: HistogramSpec = {
  label: "Pace",
  formatTick: (lo) => formatPaceClock(lo),
  formatRange: (lo, hi) => `${formatPaceClock(lo)}–${formatPace(hi)}`,
};

/** Kilometres, over whatever range was actually covered. */
export const DISTANCE_HISTOGRAM: HistogramSpec = {
  label: "Distance",
  formatTick: (lo) => formatInteger(lo),
  formatRange: (lo, hi) => `${formatInteger(lo)}–${formatInteger(hi)} km`,
};

/** Average heart rate per activity, bpm. */
export const HR_HISTOGRAM: HistogramSpec = {
  label: "Average HR",
  formatTick: (lo) => formatInteger(lo),
  formatRange: (lo, hi) => `${formatInteger(lo)}–${formatHeartRate(hi)}`,
};

/**
 * How many activities a histogram actually describes. `sample_size` counts everything
 * the filter matched, including the ones with nothing to bucket — a gym session has no
 * pace and no distance — so the bars' own sum is the honest denominator.
 */
export function bucketedCount(buckets: readonly HistogramBucket[]): number {
  return buckets.reduce((sum, bucket) => sum + bucket.count, 0);
}

/** "262 of 488 activities", or just the count when every one of them is in there. */
export function coverageNote(buckets: readonly HistogramBucket[], sampleSize: number): string {
  const counted = bucketedCount(buckets);
  if (counted >= sampleSize) return `${formatInteger(counted)} activities`;
  return `${formatInteger(counted)} of ${formatInteger(sampleSize)} activities`;
}

/** The zones with any time in them; `HrZonesChart` wants `{ zone, seconds }`. */
export function zoneTimes(zones: readonly HrZoneShare[]): { zone: number; seconds: number }[] {
  return zones
    .filter((zone) => zone.seconds > 0)
    .map((zone) => ({ zone: zone.zone, seconds: zone.seconds }));
}

/**
 * "6:33:39 of 409 h", so the bar cannot pass itself off as the whole history.
 *
 * Garmin sends per-zone seconds for some activities and not others — on this account,
 * ten of 488 — and there is no count of which in the payload. Setting the zone time
 * against the moving time of everything says the same thing with numbers that are
 * both there, and needs no new field.
 */
export function zoneCoverageNote(zoneSeconds: number, totalMovingTimeS: number): string {
  if (totalMovingTimeS <= 0) return formatDuration(zoneSeconds);
  return `${formatDuration(zoneSeconds)} of ${formatHours(totalMovingTimeS)}`;
}
