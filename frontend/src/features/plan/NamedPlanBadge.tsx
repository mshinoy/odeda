import { cn } from "@/lib/utils";
import { namedPlanLine, namedPlanProgress, type NamedPlan } from "@/features/plan/namedPlan";

/**
 * Which plan is driving the numbers: its name and week, with a thin bar for how far in.
 * Higdon's distances are the day's targets over the calendar's, and nothing on the page
 * said so before this.
 */
export function NamedPlanBadge({ plan, plain = false }: { plan: NamedPlan; plain?: boolean }) {
  const share = Math.round(namedPlanProgress(plan) * 100);
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-4 gap-y-2",
        !plain && "bg-card shadow-card rounded-2xl border px-5 py-3",
      )}
      data-testid="named-plan"
    >
      <span className="text-sm font-semibold">{namedPlanLine(plan)}</span>
      <span className="text-muted-foreground text-xs">its distances are your targets</span>
      <span
        className="bg-muted ml-auto h-1.5 w-32 overflow-hidden rounded-full"
        role="img"
        aria-label={`${share}% of the plan`}
      >
        <span className="bg-primary block h-full rounded-full" style={{ width: `${share}%` }} />
      </span>
    </div>
  );
}
