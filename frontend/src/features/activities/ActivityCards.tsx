import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface ActivityCardsProps {
  /** True while the next page or sort loads: the current cards stay, dimmed. */
  stale: boolean;
  /** `ActivityCard`s, or `ActivityCardSkeleton`s while loading. */
  children: ReactNode;
}

/** One card per row, two side by side on a wide screen. */
export function ActivityCards({ stale, children }: ActivityCardsProps) {
  return (
    <div
      className={cn("grid gap-4 transition-opacity 2xl:grid-cols-2", stale && "opacity-60")}
      aria-busy={stale}
    >
      {children}
    </div>
  );
}
