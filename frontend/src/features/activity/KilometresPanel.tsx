import { cn } from "@/lib/utils";
import type { Kilometres } from "@/features/activity/kilometres";

/**
 * The kilometres as rows of bars, longer is faster. The slowest is picked out so the one
 * to ask about is the one that stands out.
 */
export function KilometresPanel({ data, className }: { data: Kilometres; className?: string }) {
  if (data.rows.length === 0) return null;
  const slowest = data.rows.reduce((a, b) => (b.widthPct < a.widthPct ? b : a));
  return (
    <section
      className={cn(
        "bg-card shadow-card flex min-h-0 flex-col gap-3 rounded-2xl border p-5",
        className,
      )}
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold">
          {data.unit === "km" ? "Kilometres" : "Every 5 km"}
        </h2>
        <span className="text-muted-foreground text-xs">longer bar is faster</span>
      </div>
      <ul className="flex min-h-0 flex-1 flex-col justify-between gap-1.5 overflow-y-auto pr-1">
        {data.rows.map((row) => (
          <li
            key={row.label}
            className="grid grid-cols-[3.5rem_minmax(0,1fr)_5.5rem] items-center gap-3 text-sm"
          >
            <span className="text-muted-foreground text-right tabular-nums">{row.label}</span>
            <span className="bg-muted h-3 overflow-hidden rounded-full">
              <span
                className={cn(
                  "block h-full rounded-full",
                  row === slowest ? "bg-status-warning" : "bg-kind-run",
                )}
                style={{ width: `${row.widthPct}%` }}
              />
            </span>
            <span
              className={cn("whitespace-nowrap tabular-nums", row === slowest && "font-medium")}
            >
              {row.value}
            </span>
          </li>
        ))}
      </ul>
      {data.summary && <p className="text-ink-secondary border-t pt-3 text-sm">{data.summary}</p>}
    </section>
  );
}
