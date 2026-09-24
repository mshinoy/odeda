import type { components } from "@/api/schema";
import { StatCard } from "@/components/StatCard";
import { projectedPace } from "@/features/status/race";
import { formatDate, formatDays, formatDuration, formatPace } from "@/lib/format";

type SummaryRace = components["schemas"]["SummaryRace"];

export function RacePanel({ race }: { race: SummaryRace }) {
  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <span className="text-muted-foreground text-xs">
          {race.name} · {formatDate(race.date)}
        </span>
        <span className="text-display font-semibold tracking-tight">
          {formatDays(race.days_to_go)}
        </span>
      </div>
      {race.projection && (
        <div className="grid grid-cols-2 gap-6">
          <StatCard label="Projected" value={formatDuration(race.projection.projected_seconds)} />
          <StatCard label="Pace" value={formatPace(projectedPace(race))} />
        </div>
      )}
    </section>
  );
}
