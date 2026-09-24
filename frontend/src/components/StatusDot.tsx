import { cn } from "@/lib/utils";

type Tone = "good" | "warning" | "serious" | "critical" | "neutral";

const toneClass: Record<Tone, string> = {
  good: "bg-status-good",
  warning: "bg-status-warning",
  serious: "bg-status-serious",
  critical: "bg-status-critical",
  neutral: "bg-muted-foreground",
};

/** A status colour always sits next to its label, never alone. */
export function StatusDot({ tone, label }: { tone: Tone; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("size-2 rounded-full", toneClass[tone])} aria-hidden />
      {label}
    </span>
  );
}
