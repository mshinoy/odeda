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

interface KindBadgeProps {
  kind: ActivityKind;
  label: string;
}

/** The activity kind's fixed colour as a dot, with a text label so colour is never alone. */
export function KindBadge({ kind, label }: KindBadgeProps) {
  return (
    <span className="text-muted-foreground inline-flex items-center gap-1.5 text-sm">
      <span className={cn("size-2 rounded-full", dotClass[kind])} aria-hidden />
      {label}
    </span>
  );
}
