// What the page says about a stretch the watch did not record, in one testable place.
import type { ActivityGap } from "@/api/adapters";
import type { ActivityKind } from "@/lib/activityKind";
import { formatDate, formatDistance, formatRoughDuration, formatSportSpeed } from "@/lib/format";

export interface GapNote {
  /** "Not recorded for 28 min". */
  heading: string;
  /** What is known and what is guessed, and that none of it is in the totals. */
  detail: string;
}

/**
 * Plain about what is a guess. With an estimate it names the ride the path came from, so
 * it can be checked; without one it says the path is not known rather than drawing a line.
 */
export function gapNote(gap: ActivityGap, kind: ActivityKind): GapNote {
  const heading = `Not recorded for ${formatRoughDuration(gap.seconds)}`;
  const estimate = gap.estimate;
  if (estimate === null) {
    return {
      heading,
      detail:
        `The watch resumed ${formatDistance(gap.straightM)} away in a straight line. ` +
        "None of your other activities covers that stretch, so its path is not drawn.",
    };
  }
  const from = estimate.source.name ?? "another activity";
  const when = estimate.source.day === null ? "" : ` on ${formatDate(estimate.source.day)}`;
  return {
    heading,
    detail:
      `Estimated from your ${from}${when}: about ${formatDistance(estimate.lengthM)}, ` +
      `${formatSportSpeed(estimate.avgSpeedMps, kind)} on average. ` +
      "Not counted in this activity's totals.",
  };
}
