import { cn } from "@/lib/utils";

interface StatCardProps {
  label: string;
  value: string;
  /** Already formatted, e.g. "▲ 4% vs last week". */
  delta?: string;
  deltaTone?: "good" | "bad" | "neutral";
}

const deltaClass = {
  good: "text-delta-good",
  bad: "text-delta-bad",
  neutral: "text-muted-foreground",
} as const;

/** One big number, a small label, an optional delta. Nothing else. */
export function StatCard({ label, value, delta, deltaTone = "neutral" }: StatCardProps) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="text-stat font-semibold tracking-tight">{value}</span>
      {delta && <span className={cn("text-xs", deltaClass[deltaTone])}>{delta}</span>}
    </div>
  );
}
