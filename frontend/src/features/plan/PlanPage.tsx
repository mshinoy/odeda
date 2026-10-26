import { Link, useSearchParams } from "react-router-dom";
import {
  useClearPlanLink,
  usePlan,
  usePlanSessions,
  usePlanWeek,
  useRace,
  useSetPlanLink,
} from "@/api/queries/usePlan";
import { usePerformance } from "@/api/queries/usePerformance";
import { EmptyState } from "@/components/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { StatCard } from "@/components/StatCard";
import { calendarWeeks, efficacySentence, verdictSentence } from "@/features/plan/planView";
import { PlanCalendar } from "@/features/plan/PlanCalendar";
import { PlanWeekDetail } from "@/features/plan/PlanWeekDetail";
import { formatDecimal, formatPercent } from "@/lib/format";

/** The whole block, week by week: what was asked for, what happened, and whether it worked. */
export function PlanPage() {
  const plan = usePlan();
  const sessions = usePlanSessions();
  const race = useRace();
  const performance = usePerformance();
  // The opened week lives in the URL (`?week=2026-09-21`), like every other view's
  // state: a week worth looking at is a week worth sending to yourself.
  const [params, setParams] = useSearchParams();
  const openWeek = params.get("week");
  const week = usePlanWeek(openWeek);
  // `preventScrollReset`: the shell's ScrollRestoration would otherwise send the page to
  // the top on every URL change, including opening a week you are already looking at.
  const toggleWeek = (start: string) =>
    setParams(openWeek === start ? {} : { week: start }, {
      replace: true,
      preventScrollReset: true,
    });
  const setLink = useSetPlanLink();
  const clearLink = useClearPlanLink();

  if (plan.isPending) return <PlanPageSkeleton />;
  if (plan.error) return <EmptyState message={plan.error.message} />;

  if (!plan.data.subscribed) {
    return (
      <EmptyState
        message="No training plan is connected."
        action={<Link to="/settings">Connect the calendar</Link>}
      />
    );
  }

  const efficacy = efficacySentence({
    decoupling: performance.data?.decoupling_recent ?? [],
    projectedSeconds: race.data?.projection?.projected_seconds ?? null,
  });
  const weeks = calendarWeeks(plan.data.weeks, sessions.data?.sessions ?? [], plan.data.today);
  const busy = setLink.isPending || clearLink.isPending;

  return (
    <div className="flex flex-col gap-10">
      <section className="flex flex-col gap-2">
        <h1 className="text-stat font-semibold tracking-tight">{verdictSentence(plan.data)}</h1>
        {efficacy && <p className="text-muted-foreground text-sm">{efficacy}</p>}
      </section>

      <div className="grid grid-cols-3 gap-6">
        <StatCard label="Adherence, 4 weeks" value={formatPercent(plan.data.adherence_4wk)} />
        <StatCard
          label="Peak week"
          value={
            plan.data.targets.peak_weekly_km === null
              ? "—"
              : `${formatDecimal(plan.data.targets.peak_weekly_km)} km`
          }
        />
        <StatCard
          label="Fitness it implies"
          value={
            plan.data.targets.ctl_target === null
              ? "—"
              : formatDecimal(plan.data.targets.ctl_target)
          }
          delta={plan.data.targets.ctl_target === null ? undefined : "derived from your own pace"}
        />
      </div>

      {sessions.isPending ? (
        <Skeleton className="h-96" />
      ) : (
        <PlanCalendar
          weeks={weeks}
          openWeek={openWeek}
          onOpenWeek={toggleWeek}
          renderDetail={() =>
            week.data ? (
              <PlanWeekDetail
                week={week.data}
                busy={busy}
                onLink={(sessionId, activityId) => setLink.mutate({ sessionId, activityId })}
                onIgnore={(sessionId) => setLink.mutate({ sessionId, ignore: true })}
                onClear={(sessionId) => clearLink.mutate(sessionId)}
              />
            ) : (
              <Skeleton className="mx-2 my-3 h-20" />
            )
          }
        />
      )}

      {(setLink.error || clearLink.error) && (
        <p className="text-destructive text-sm">{(setLink.error ?? clearLink.error)?.message}</p>
      )}

      {plan.data.unreadable.length > 0 && (
        <p className="text-muted-foreground text-xs">
          {plan.data.unreadable.length} calendar entries could not be read. Settings lists them.
        </p>
      )}
    </div>
  );
}

function PlanPageSkeleton() {
  return (
    <div className="flex flex-col gap-10">
      <Skeleton className="h-10 w-2/3" />
      <div className="grid grid-cols-3 gap-6">
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
      </div>
      <Skeleton className="h-64" />
    </div>
  );
}
