import { useMemo } from "react";
import type { components } from "@/api/schema";
import { EChart } from "@/charts/EChart";
import { buildWeeklyKmOption, type WeeklyKmWeek } from "@/charts/plan/buildWeeklyKmOption";
import { StatCard } from "@/components/StatCard";
import { useTokens } from "@/design/theme";
import { projectedPace } from "@/features/status/race";
import { formatDate, formatDays, formatDuration, formatPace } from "@/lib/format";

type SummaryRace = components["schemas"]["SummaryRace"];

interface RacePanelProps {
  race: SummaryRace;
  /** Kilometres a week with the plan's prescription beside them; empty draws nothing. */
  weeklyKm: readonly WeeklyKmWeek[];
}

export function RacePanel({ race, weeklyKm }: RacePanelProps) {
  const tokens = useTokens();
  const option = useMemo(
    () => buildWeeklyKmOption({ weeks: [...weeklyKm], tokens }),
    [weeklyKm, tokens],
  );
  const prescribed = weeklyKm.some((w) => w.plannedKm !== null);

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
      {weeklyKm.length > 0 && (
        <figure className="flex flex-col gap-1">
          <figcaption className="text-muted-foreground text-xs">
            {prescribed ? "Weekly km, against the plan" : "Weekly km"}
          </figcaption>
          <EChart option={option} height={160} />
        </figure>
      )}
    </section>
  );
}
