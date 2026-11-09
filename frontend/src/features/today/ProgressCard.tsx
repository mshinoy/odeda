import { useMemo } from "react";
import { EChart } from "@/charts/EChart";
import { buildWeeklyKmOption, type WeeklyKmWeek } from "@/charts/plan/buildWeeklyKmOption";
import { useTokens } from "@/design/theme";
import { useElementHeight } from "@/features/today/useElementHeight";
import { weeksAround } from "@/features/today/todayView";

/** Weeks of kilometres behind and just ahead, the bars against the plan's line. */
export function ProgressCard({
  weeklyKm,
  thisStart,
}: {
  weeklyKm: readonly WeeklyKmWeek[];
  thisStart: string;
}) {
  const tokens = useTokens();
  const { ref, height } = useElementHeight<HTMLDivElement>(80);
  const option = useMemo(
    () => buildWeeklyKmOption({ weeks: weeksAround(weeklyKm, thisStart), tokens }),
    [weeklyKm, thisStart, tokens],
  );
  if (weeklyKm.length === 0) return null;
  return (
    <figure className="bg-card shadow-card flex min-h-0 flex-1 flex-col gap-1 rounded-2xl border px-6 py-3">
      <figcaption className="text-base font-semibold">Weekly km, against the plan</figcaption>
      <div ref={ref} className="min-h-[6.25rem] flex-1">
        <EChart option={option} height={height} />
      </div>
    </figure>
  );
}
