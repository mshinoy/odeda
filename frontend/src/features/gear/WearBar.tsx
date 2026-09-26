import type { Wear } from "@/features/gear/gearView";
import { wearLabel, wearTone } from "@/features/gear/gearView";
import { cn } from "@/lib/utils";

const fillClass: Record<string, string> = {
  good: "bg-status-good",
  warning: "bg-status-warning",
  critical: "bg-status-critical",
  neutral: "bg-muted-foreground",
};

/**
 * How worn an item is against its retirement distance.
 *
 * The colour always comes with its word (`wearLabel`), because a status colour on
 * its own says nothing to a reader who cannot tell amber from green.
 */
export function WearBar({ wear }: { wear: Wear }) {
  const tone = wearTone[wear.state];
  const label = wearLabel[wear.state];

  return (
    <div
      role="meter"
      aria-valuenow={wear.pct ?? undefined}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className="bg-muted h-1.5 w-full overflow-hidden rounded-full"
    >
      <div
        className={cn("h-full rounded-full transition-[width] duration-150", fillClass[tone])}
        style={{ width: `${wear.fraction * 100}%` }}
      />
    </div>
  );
}
