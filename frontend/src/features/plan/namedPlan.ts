// The plan that drives the day's numbers, as lines the pages can show.
import type { Plan } from "@/api/queries/usePlan";

export type ActivePlan = NonNullable<Plan["active_plan"]>;

/** "Higdon Novice 1 · week 5 of 12" for a published plan; the calendar's own name otherwise. */
export function activePlanLine(plan: ActivePlan): string {
  if (plan.kind === "named" && plan.week != null && plan.weeks != null) {
    return `${plan.name} · week ${plan.week} of ${plan.weeks}`;
  }
  return plan.name;
}

/** What the plan's name means for the numbers on the page. */
export function activePlanNote(plan: ActivePlan): string {
  return plan.kind === "named" ? "sets your targets" : "your calendar";
}
