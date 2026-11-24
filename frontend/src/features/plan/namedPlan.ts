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
  return plan.kind === "named"
    ? "its distances are your targets"
    : "your calendar, no published plan on top";
}

/** How far through a published plan, 0 to 1; null for a calendar, which has no end. */
export function activePlanProgress(plan: ActivePlan): number | null {
  if (plan.kind !== "named" || plan.week == null || plan.weeks == null || plan.weeks <= 0) {
    return null;
  }
  return Math.min(1, Math.max(0, plan.week / plan.weeks));
}
