import { activePlanLine, activePlanNote, type ActivePlan } from "@/features/plan/namedPlan";
import { cn } from "@/lib/utils";

/**
 * Which plan is driving the numbers. A published plan (Higdon Novice 1, week 5 of 12)
 * takes precedence; with none, the calendar itself is named, so the page always says
 * where its sessions come from.
 */
export function NamedPlanBadge({ plan, plain = false }: { plan: ActivePlan; plain?: boolean }) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-baseline gap-x-3 gap-y-1",
        !plain && "bg-card shadow-card rounded-2xl border px-5 py-3",
      )}
      data-testid="named-plan"
    >
      <span className="text-sm font-semibold">{activePlanLine(plan)}</span>
      <span className="text-muted-foreground text-xs">{activePlanNote(plan)}</span>
    </div>
  );
}
