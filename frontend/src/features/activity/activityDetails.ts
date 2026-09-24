// What the detail blocks below the charts show, decided from the data alone. A block
// with nothing to show is left out rather than drawn empty.
import type { BestEffort, HrZoneTime, Split } from "@/api/adapters";
import type { ActivityKind } from "@/lib/activityKind";
import { formatDistance, formatDuration, formatSportSpeed } from "@/lib/format";

// One split only repeats the activity's average pace.
const MIN_SPLITS = 2;

/** The splits worth a chart: those with a time, and only when there are at least two. */
export function chartedSplits(splits: readonly Split[]): Split[] {
  const timed = splits.filter((split) => split.seconds > 0);
  return timed.length >= MIN_SPLITS ? timed : [];
}

export function hasZoneTime(zones: readonly HrZoneTime[]): boolean {
  return zones.some((zone) => zone.seconds > 0);
}

export interface BestEffortRow {
  key: string;
  distance: string;
  time: string;
  pace: string;
}

/** Shortest distance first; the pace is in the sport's own unit. */
export function bestEffortRows(
  efforts: readonly BestEffort[],
  kind: ActivityKind,
): BestEffortRow[] {
  return efforts
    .filter((effort) => effort.seconds > 0)
    .sort((a, b) => a.distanceM - b.distanceM)
    .map((effort) => ({
      key: String(effort.distanceM),
      distance: effort.label ?? formatDistance(effort.distanceM),
      time: formatDuration(effort.seconds),
      pace: formatSportSpeed(effort.distanceM / effort.seconds, kind),
    }));
}
