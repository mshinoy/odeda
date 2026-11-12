import { cn } from "@/lib/utils";
import type { Blocks } from "@/features/activity/intervals";
import { HrBar, PlanLine } from "@/features/activity/IntervalsPanel";

/**
 * A workout without walk or rest steps (a tempo, a threshold, a negative split), one row
 * per step: how long, how fast, the peak heart rate against Zone 2, and the step's target.
 */
export function WorkoutPanel({
  data,
  ceiling,
  className,
}: {
  data: Blocks;
  ceiling: number | null;
  className?: string;
}) {
  if (data.rows.length === 0) return null;

  const peaks = data.rows.flatMap((r) => (r.maxHr === null ? [] : [r.maxHr]));
  const floors = data.rows.flatMap((r) => (r.avgHr === null ? [] : [r.avgHr]));
  const top = Math.max(...peaks, ceiling ?? 0) + 4;
  const bottom = Math.min(...floors, ceiling ?? Infinity) - 10;
  const at = (bpm: number) =>
    top > bottom ? Math.max(0, Math.min(100, ((bpm - bottom) / (top - bottom)) * 100)) : 0;
  const ceilingPct = ceiling === null ? null : at(ceiling);

  return (
    <section
      className={cn(
        "bg-card shadow-card flex min-h-0 flex-col gap-3 rounded-2xl border p-5",
        className,
      )}
    >
      <h2 className="text-lg font-semibold">Workout</h2>
      {data.summary.length > 0 && <p className="text-sm">{data.summary.join(" ")}</p>}
      {ceiling !== null && (
        <p className="text-muted-foreground border-t pt-3 text-xs">
          Each bar runs to the step&apos;s peak heart rate. The line marks the top of Zone 2 (
          {ceiling}).
        </p>
      )}
      <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1">
        {data.rows.map((row) => (
          <li key={row.label} className="flex flex-col gap-0.5">
            <div
              className={cn(
                "grid grid-cols-[5rem_2.5rem_minmax(0,1fr)_4.5rem] items-center gap-2 text-sm",
                row.kind !== "main" && "text-muted-foreground",
              )}
            >
              <span className={cn(row.kind === "main" && "font-medium")}>{row.label}</span>
              <span
                className={cn(
                  "tabular-nums",
                  row.plan?.heldPlan === false && "text-status-warning",
                )}
              >
                {row.time}
              </span>
              <HrBar maxHr={row.maxHr} over={row.overCeiling} ceilingPct={ceilingPct} at={at} />
              <span className="text-right whitespace-nowrap tabular-nums">
                <span className="text-muted-foreground text-xs">peak </span>
                {row.maxHr ?? "–"}
              </span>
            </div>
            <p className="text-muted-foreground pl-[5.5rem] text-xs tabular-nums">
              {[row.distance, row.pace, row.avgHr === null ? null : `avg ${row.avgHr} bpm`]
                .filter(Boolean)
                .join(" · ")}
            </p>
            <PlanLine plan={row.plan} />
          </li>
        ))}
      </ul>
    </section>
  );
}
