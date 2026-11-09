import type { ActivitySummary } from "@/api/adapters";
import { StatCard } from "@/components/StatCard";
import { formatDistance, formatDuration, formatHeartRate, formatSportSpeed } from "@/lib/format";
import { paceScale } from "@/lib/metrics";

/**
 * The four numbers people look for first. Climb, calories, cadence, load and the rest are
 * under Details, one click away: six big numbers with nothing to compare them against were
 * the least useful part of the page.
 */
export function ActivityStats({ summary }: { summary: ActivitySummary }) {
  return (
    <div className="grid grid-cols-2 gap-x-8 gap-y-6 sm:grid-cols-4">
      <StatCard label="Distance" value={formatDistance(summary.distanceM)} />
      <StatCard label="Moving time" value={formatDuration(summary.movingTimeS)} />
      {/* "Speed" on a bike, "Pace" on foot and in water: the same word the chart uses. */}
      <StatCard
        label={paceScale(summary.kind).label}
        value={formatSportSpeed(summary.avgSpeedMps, summary.kind)}
      />
      <StatCard label="Avg HR" value={formatHeartRate(summary.avgHr)} />
    </div>
  );
}
