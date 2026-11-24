// The published plan that drives the day's numbers, as one line the pages can show.
import type { Plan } from "@/api/queries/usePlan";

export type NamedPlan = NonNullable<Plan["named_plan"]>;

/** "Higdon Novice 1 · week 5 of 12". */
export function namedPlanLine(plan: NamedPlan): string {
  return `${plan.name} · week ${plan.week} of ${plan.weeks}`;
}

/** How far through the plan, 0 to 1, counting the current week as under way. */
export function namedPlanProgress(plan: NamedPlan): number {
  if (plan.weeks <= 0) return 0;
  return Math.min(1, Math.max(0, plan.week / plan.weeks));
}
