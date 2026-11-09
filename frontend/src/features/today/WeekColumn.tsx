import { Link } from "react-router-dom";
import type { Plan, PlanWeekDetail } from "@/api/queries/usePlan";
import { DayLine, DayRow } from "@/features/today/DayRow";
import { weekDays } from "@/features/today/todayView";
import { formatDecimal } from "@/lib/format";

interface WeekColumnProps {
  plan: Plan;
  thisWeek: PlanWeekDetail | undefined;
  lastWeek: PlanWeekDetail | undefined;
}

/**
 * The week down the side: this week day by day with what was done and missed, and last
 * week below it in one line a day. Vertical, so both weeks sit beside the headline and
 * the page needs no scrolling.
 */
export function WeekColumn({ plan, thisWeek, lastWeek }: WeekColumnProps) {
  const summary = plan.this_week;
  const previous = plan.weeks.find((w) => w.start === lastWeek?.start);
  const days = thisWeek ? weekDays(thisWeek.start, thisWeek.sessions, plan.today) : [];
  const lastDays = lastWeek ? weekDays(lastWeek.start, lastWeek.sessions, plan.today) : [];
  const pct =
    summary && summary.planned_km > 0
      ? Math.min(100, (summary.actual_km / summary.planned_km) * 100)
      : 0;

  return (
    <section className="bg-card shadow-card short:gap-0 short:p-3 flex flex-col gap-1 rounded-2xl border p-4">
      <div className="flex items-baseline justify-between gap-3 px-2">
        <Link to="/plan" className="text-lg font-semibold underline-offset-4 hover:underline">
          This week
        </Link>
        {summary && (
          <span className="text-ink-secondary text-xs">
            {summary.sessions_done} of {summary.sessions_prescribed} ·{" "}
            {formatDecimal(summary.actual_km)} of {formatDecimal(summary.planned_km)} km
          </span>
        )}
      </div>
      <div className="bg-muted short:hidden mx-2 mb-1 h-1.5 overflow-hidden rounded-full">
        <div className="bg-kind-run h-full rounded-full" style={{ width: `${pct}%` }} />
      </div>
      <div className="flex flex-[1.3] flex-col gap-1">
        {days.map((d) => (
          <DayRow key={d.day} day={d} />
        ))}
      </div>

      {lastDays.length > 0 && (
        <>
          <div className="mt-2 flex items-baseline justify-between gap-3 border-t px-2 pt-3">
            <h2 className="text-lg font-semibold">Last week</h2>
            {previous && (
              <span className="text-ink-secondary text-xs">
                {previous.sessions_done} of {previous.sessions_prescribed} ·{" "}
                {formatDecimal(previous.actual_km)} of {formatDecimal(previous.planned_km)} km
              </span>
            )}
          </div>
          <div className="flex flex-1 flex-col gap-1">
            {lastDays.map((d) => (
              <DayLine key={d.day} day={d} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
