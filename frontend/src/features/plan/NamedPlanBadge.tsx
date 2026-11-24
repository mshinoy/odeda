import {
  activePlanLine,
  activePlanNote,
  activePlanProgress,
  type ActivePlan,
} from "@/features/plan/namedPlan";
import { cn } from "@/lib/utils";

/**
 * Which plan is driving the numbers. A published plan (Higdon Novice 1, week 5 of 12)
 * takes precedence and shows a thin bar for how far in; with none, the calendar itself
 * is named, so the page always says where its sessions come from.
 */
export function NamedPlanBadge({ plan, plain = false }: { plan: ActivePlan; plain?: boolean }) {
  const progress = activePlanProgress(plan);
  const share = progress === null ? null : Math.round(progress * 100);
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-4 gap-y-2",
        !plain && "bg-card shadow-card rounded-2xl border px-5 py-3",
      )}
      data-testid="named-plan"
    >
      <span className="text-sm font-semibold">{activePlanLine(plan)}</span>
      <span className="text-muted-foreground text-xs">{activePlanNote(plan)}</span>
      {share !== null && (
        <span
          className="bg-muted ml-auto h-1.5 w-32 overflow-hidden rounded-full"
          role="img"
          aria-label={`${share}% of the plan`}
        >
          <span className="bg-primary block h-full rounded-full" style={{ width: `${share}%` }} />
        </span>
      )}
    </div>
  );
}
