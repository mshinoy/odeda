import type { ActivityKind } from "@/lib/activityKind";
import { cn } from "@/lib/utils";

// Static class names so Tailwind sees them; the colours themselves are tokens.
const dotClass: Record<ActivityKind, string> = {
  run: "bg-kind-run",
  ride: "bg-kind-ride",
  swim: "bg-kind-swim",
  walk: "bg-kind-walk",
  strength: "bg-kind-strength",
  other: "bg-kind-other",
};

/** A kind's fixed colour as a dot. Always beside a title that says the same in words. */
export function KindDot({ kind, className }: { kind: ActivityKind; className?: string }) {
  return (
    <span className={cn("size-2 shrink-0 rounded-full", dotClass[kind], className)} aria-hidden />
  );
}
