import { useMemo } from "react";
import { Link } from "react-router-dom";
import type { Plan, PlanWeekDetail } from "@/api/queries/usePlan";
import { EChart } from "@/charts/EChart";
import { buildWeeklyKmOption, type WeeklyKmWeek } from "@/charts/plan/buildWeeklyKmOption";
import { useTokens } from "@/design/theme";
import { DayTile } from "@/features/today/DayTile";
import { weeksAround, weekDays } from "@/features/today/todayView";
import { formatDecimal } from "@/lib/format";

interface WeekCardProps {
  plan: Plan;
  thisWeek: PlanWeekDetail | undefined;
  lastWeek: PlanWeekDetail | undefined;
  weeklyKm: readonly WeeklyKmWeek[];
}

/**
 * This week day by day, what became of last week, and the weeks before as bars. The
 * answer to "am I on it" in three scans: the strip, the sentence under it, the bars.
 */
export function WeekCard({ plan, thisWeek, lastWeek, weeklyKm }: WeekCardProps) {
  const tokens = useTokens();
  const option = useMemo(
    () =>
      buildWeeklyKmOption({
        weeks: weeksAround(weeklyKm, plan.this_week?.start ?? plan.today),
        tokens,
      }),
    [weeklyKm, plan.this_week?.start, plan.today, tokens],
  );
  const summary = plan.this_week;
  const previous = plan.weeks.find((w) => w.start === lastWeek?.start);
  const days = thisWeek ? weekDays(thisWeek.start, thisWeek.sessions, plan.today) : [];
  const lastDays = lastWeek ? weekDays(lastWeek.start, lastWeek.sessions, plan.today) : [];
  const pct =
    summary && summary.planned_km > 0
      ? Math.min(100, (summary.actual_km / summary.planned_km) * 100)
      : 0;

  return (
    <section className="bg-card shadow-card flex flex-col gap-5 rounded-2xl border p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold">This week</h2>
        <div className="flex items-baseline gap-4">
          {summary && (
            <span className="text-ink-secondary text-sm">
              {summary.sessions_done} of {summary.sessions_prescribed} sessions ·{" "}
              {formatDecimal(summary.actual_km)} of {formatDecimal(summary.planned_km)} km
            </span>
          )}
          <Link
            to="/plan"
            className="text-muted-foreground hover:text-foreground text-xs underline underline-offset-4"
          >
            The whole plan
          </Link>
        </div>
      </div>
      <div className="bg-muted h-1.5 overflow-hidden rounded-full">
        <div className="bg-kind-run h-full rounded-full" style={{ width: `${pct}%` }} />
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {days.map((d) => (
          <DayTile key={d.day} day={d} />
        ))}
      </div>

      {lastDays.length > 0 && (
        <div className="flex flex-col gap-3 border-t pt-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-medium">Last week</h3>
            {previous && (
              <span className="text-ink-secondary text-sm">
                {previous.sessions_done} of {previous.sessions_prescribed} sessions ·{" "}
                {formatDecimal(previous.actual_km)} of {formatDecimal(previous.planned_km)} km
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
            {lastDays.map((d) => (
              <DayTile key={d.day} day={d} />
            ))}
          </div>
        </div>
      )}

      {weeklyKm.length > 0 && (
        <figure className="flex flex-col gap-1 border-t pt-4">
          <figcaption className="text-muted-foreground text-xs">
            Weekly km, against the plan
          </figcaption>
          <EChart option={option} height={120} />
        </figure>
      )}
    </section>
  );
}
