import type { RouteDetail } from "@/api/adapters";
import { StatCard } from "@/components/StatCard";
import { formatDistance, formatDuration, formatInteger } from "@/lib/format";

/**
 * Best, median, and the gap between the first counted attempt and the last. That gap
 * is two single runs, not a trend, so the card says which two it compares.
 */
export function RouteStats({ detail }: { detail: RouteDetail }) {
  const { stats } = detail;
  const change = stats.improvementS;

  return (
    <div className="grid grid-cols-2 gap-x-8 gap-y-6 sm:grid-cols-3 lg:grid-cols-5">
      <StatCard label="Attempts" value={formatInteger(detail.countedCount)} />
      <StatCard label="Distance" value={formatDistance(detail.route.distanceM)} />
      <StatCard label="Best" value={formatDuration(stats.bestTimeS)} />
      <StatCard label="Median" value={formatDuration(stats.medianTimeS)} />
      <StatCard
        label="First to last"
        value={formatDuration(change === null ? null : Math.abs(change))}
        delta={change === null ? undefined : change > 0 ? "faster" : "slower"}
        deltaTone={change !== null && change > 0 ? "good" : "bad"}
      />
    </div>
  );
}
