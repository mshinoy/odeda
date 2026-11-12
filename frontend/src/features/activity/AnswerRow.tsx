import { useMemo } from "react";
import type { Activity } from "@/api/adapters";
import { useActivityPlan } from "@/api/queries/useActivityPlan";
import { useRoute } from "@/api/queries/useRoute";
import { Skeleton } from "@/components/ui/skeleton";
import { EffortCard, PlanCard, RouteCard } from "@/features/activity/AnswerCards";
import { effortAnswer, planAnswer, routeAnswer } from "@/features/activity/answers";
import { cn } from "@/lib/utils";

const COLUMNS: Record<number, string> = {
  1: "md:grid-cols-1",
  2: "md:grid-cols-2",
  3: "md:grid-cols-3",
};

/**
 * Three questions, answered before any chart: did it do what the plan wanted, how did it
 * compare with the last times on its route, and how hard was it. A card with nothing to
 * say is left out, so an unplanned ride on no route shows only its effort.
 */
export function AnswerRow({ activity }: { activity: Activity }) {
  const { summary, route: filed, hrZones } = activity;
  const plan = useActivityPlan(summary.id);
  const routeId = filed?.id ?? null;
  const route = useRoute(routeId ?? -1, routeId !== null);

  const cards = useMemo(() => {
    const plans = planAnswer(plan.data);
    const routes = routeAnswer(route.data?.attempts ?? [], summary.id, summary.distanceM);
    const effort = effortAnswer(hrZones, summary.trimp, summary.avgHr, summary.maxHr);
    return [
      plans && <PlanCard key="plan" answer={plans} kind={summary.kind} />,
      routes && <RouteCard key="route" answer={routes} />,
      effort && <EffortCard key="effort" answer={effort} />,
    ].filter(Boolean);
  }, [plan.data, route.data, summary, hrZones]);

  const loading = plan.isPending || (routeId !== null && route.isPending);
  if (loading) return <Skeleton className="h-40 rounded-2xl" />;
  if (cards.length === 0) return null;
  return <div className={cn("grid gap-5", COLUMNS[Math.min(cards.length, 3)])}>{cards}</div>;
}
