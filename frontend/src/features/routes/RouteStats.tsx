import type { RouteDetail } from "@/api/adapters";
import { StatCard } from "@/components/StatCard";
import { formatDistance, formatDuration, formatInteger, formatSportSpeed } from "@/lib/format";

/**
 * A route's headline numbers. Round a loop they are about the lap — a session is any
 * number of laps, so its time says nothing alone — and otherwise about the attempt:
 * best, median, and the gap between the first counted attempt and the last. That gap
 * is two single runs, not a trend, so the card says which two it compares.
 */
export function RouteStats({ detail }: { detail: RouteDetail }) {
  return detail.route.layout === "loop" ? (
    <LapStats detail={detail} />
  ) : (
    <AttemptStats detail={detail} />
  );
}

function LapStats({ detail }: { detail: RouteDetail }) {
  const { stats } = detail;
  const lapM = stats.lapM ?? detail.route.distanceM;
  // The fastest lap's speed in the unit the sport thinks in: pace on foot, km/h on a bike.
  const speed = stats.bestLapS === null ? null : lapM / stats.bestLapS;

  return (
    <div className="grid grid-cols-2 gap-x-8 gap-y-6 sm:grid-cols-3 lg:grid-cols-5">
      <StatCard label="Attempts" value={formatInteger(detail.countedCount)} />
      <StatCard label="Lap" value={formatDistance(lapM)} />
      <StatCard label="Laps" value={formatInteger(stats.laps)} />
      <StatCard
        label="Fastest lap"
        value={formatDuration(stats.bestLapS)}
        delta={speed === null ? undefined : formatSportSpeed(speed, detail.route.kind)}
      />
      <StatCard label="Median lap" value={formatDuration(stats.medianLapS)} />
    </div>
  );
}

function AttemptStats({ detail }: { detail: RouteDetail }) {
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
