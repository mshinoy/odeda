import { Link, useSearchParams } from "react-router-dom";
import {
  useClearPlanLink,
  usePlan,
  usePlanSessions,
  usePlanSteer,
  usePlanWeek,
  useRace,
  useSetPlanLink,
} from "@/api/queries/usePlan";
import { EmptyState } from "@/components/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { calendarWeeks, weeklyKmSeries } from "@/features/plan/planView";
import { ChangePlanCard } from "@/features/plan/ChangePlanCard";
import { PlanHistory } from "@/features/plan/PlanHistory";
import { PlanRoadCard } from "@/features/plan/PlanRoadCard";
import { PlanWeekCard } from "@/features/plan/PlanWeekCard";
import { PlanWeekDetail } from "@/features/plan/PlanWeekDetail";
import { SteerCard } from "@/features/plan/SteerCard";

/** The road to the race: where you stand, this week, the weeks ahead, and the weeks behind. */
export function PlanPage() {
  const plan = usePlan();
  const steer = usePlanSteer();
  const sessions = usePlanSessions();
  const race = useRace();
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

  if (plan.isPending || steer.isPending) return <PlanPageSkeleton />;
  if (plan.error) return <EmptyState message={plan.error.message} />;
  if (steer.error) return <EmptyState message={steer.error.message} />;

  if (!plan.data.subscribed) {
    return (
      <EmptyState
        message="No training plan is connected."
        action={<Link to="/settings">Connect the calendar</Link>}
      />
    );
  }

  const weeks = calendarWeeks(plan.data.weeks, sessions.data?.sessions ?? [], plan.data.today);
  const currentIndex = weeks.findIndex((w) => w.isCurrent);
  const current = currentIndex >= 0 ? weeks[currentIndex] : undefined;
  const next = currentIndex >= 0 ? weeks[currentIndex + 1] : undefined;
  const past = (currentIndex >= 0 ? weeks.slice(0, currentIndex) : weeks).slice().reverse();
  const busy = setLink.isPending || clearLink.isPending;
  const weeklyKm = race.data ? weeklyKmSeries(race.data.weekly_km, plan.data.weeks, 30) : [];

  const detail = () =>
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
    );

  return (
    <div className="flex flex-col gap-6">
      <SteerCard steer={steer.data} plan={plan.data} />

      {sessions.isPending ? (
        <Skeleton className="h-96 rounded-2xl" />
      ) : (
        <>
          {current && (
            <PlanWeekCard
              title="This week"
              week={current}
              onCorrect={() => toggleWeek(current.start)}
              detail={openWeek === current.start ? detail() : undefined}
            />
          )}
          {next && <PlanWeekCard title="Next week" week={next} preview />}
        </>
      )}

      <PlanRoadCard weeks={weeklyKm} />

      <ChangePlanCard
        plan={plan.data}
        onEditWeek={() => {
          if (current && openWeek !== current.start) toggleWeek(current.start);
        }}
      />

      {!sessions.isPending && (
        <PlanHistory
          weeks={past}
          openWeek={openWeek}
          onOpenWeek={toggleWeek}
          renderDetail={detail}
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
    <div className="flex flex-col gap-6">
      <Skeleton className="h-72 rounded-2xl" />
      <Skeleton className="h-96 rounded-2xl" />
      <Skeleton className="h-64 rounded-2xl" />
    </div>
  );
}
