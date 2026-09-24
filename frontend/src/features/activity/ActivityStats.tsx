import type { ActivitySummary } from "@/api/adapters";
import { StatCard } from "@/components/StatCard";
import {
  formatDistance,
  formatDuration,
  formatElevation,
  formatHeartRate,
  formatInteger,
  formatSportSpeed,
} from "@/lib/format";

/** The four numbers people look for first, then the next two. */
export function ActivityStats({ summary }: { summary: ActivitySummary }) {
  return (
    <div className="grid grid-cols-2 gap-x-8 gap-y-6 sm:grid-cols-3 lg:grid-cols-6">
      <StatCard label="Distance" value={formatDistance(summary.distanceM)} />
      <StatCard label="Moving time" value={formatDuration(summary.movingTimeS)} />
      <StatCard label="Pace" value={formatSportSpeed(summary.avgSpeedMps, summary.kind)} />
      <StatCard label="Avg HR" value={formatHeartRate(summary.avgHr)} />
      <StatCard label="Elevation" value={formatElevation(summary.elevationGainM)} />
      <StatCard label="TRIMP" value={formatInteger(summary.trimp)} />
    </div>
  );
}
