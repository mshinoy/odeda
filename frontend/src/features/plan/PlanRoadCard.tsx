import { useMemo } from "react";
import { EChart } from "@/charts/EChart";
import { buildWeeklyKmOption, type WeeklyKmWeek } from "@/charts/plan/buildWeeklyKmOption";
import { useTokens } from "@/design/theme";

const CHART_HEIGHT = 260;

/**
 * The road to race day: kilometres run each week as bars, the plan's weeks, build, peak
 * and taper, as a line that carries on past the last bar to the race.
 */
export function PlanRoadCard({ weeks }: { weeks: readonly WeeklyKmWeek[] }) {
  const tokens = useTokens();
  const option = useMemo(() => buildWeeklyKmOption({ weeks, tokens }), [weeks, tokens]);
  if (weeks.length === 0) return null;

  return (
    <section className="bg-card shadow-card flex flex-col gap-4 rounded-2xl border p-7">
      <header className="flex flex-col gap-0.5">
        <h2 className="text-xl font-semibold tracking-tight">The road to race day</h2>
        <p className="text-muted-foreground text-sm">
          Kilometres run each week against what the plan asks, through to the taper.
        </p>
      </header>
      <EChart option={option} height={CHART_HEIGHT} />
    </section>
  );
}
