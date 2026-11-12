import { cn } from "@/lib/utils";
import type { IntervalRow, Intervals } from "@/features/activity/intervals";

/**
 * A structured workout, rep by rep, as the watch timed it. Each run rep's bar reaches its
 * peak heart rate, with the Zone 2 ceiling marked, so the reps that ran too hard stand
 * out; each walk says how far it brought heart rate down.
 */
export function IntervalsPanel({
  data,
  ceiling,
  className,
}: {
  data: Intervals;
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

  return (
    <section
      className={cn(
        "bg-card shadow-card flex min-h-0 flex-col gap-3 rounded-2xl border p-5",
        className,
      )}
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold">Intervals</h2>
        {data.shape && <span className="text-muted-foreground text-xs">{data.shape}</span>}
      </div>
      {data.summary.length > 0 && <p className="text-sm">{data.summary.join(" ")}</p>}
      {ceiling !== null && (
        <p className="text-muted-foreground border-t pt-3 text-xs">
          Each bar runs to the rep&apos;s peak heart rate. The line marks the top of Zone 2 (
          {ceiling}).
        </p>
      )}
      <ul className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto pr-1">
        {data.rows.map((row) =>
          row.kind === "run" ? (
            <RunRow
              key={row.label}
              row={row}
              ceilingPct={ceiling === null ? null : at(ceiling)}
              at={at}
            />
          ) : (
            <QuietRow key={row.label} row={row} />
          ),
        )}
      </ul>
    </section>
  );
}

function RunRow({
  row,
  ceilingPct,
  at,
}: {
  row: IntervalRow;
  ceilingPct: number | null;
  at: (bpm: number) => number;
}) {
  return (
    <li className="grid grid-cols-[4.5rem_2.5rem_minmax(0,1fr)_4.5rem] items-center gap-2 text-sm">
      <span className="font-medium">{row.label}</span>
      <span
        className={cn("tabular-nums", !row.onTime && "text-status-warning")}
        title={row.pace ?? undefined}
      >
        {row.time}
      </span>
      <span className="bg-muted relative h-3 rounded-full">
        {row.maxHr !== null && (
          <span
            className={cn(
              "absolute inset-y-0 left-0 rounded-full",
              row.overCeiling ? "bg-status-warning" : "bg-status-good",
            )}
            style={{ width: `${at(row.maxHr)}%` }}
          />
        )}
        {ceilingPct !== null && (
          <span
            className="bg-foreground/60 absolute -inset-y-0.5 w-px"
            style={{ left: `${ceilingPct}%` }}
            aria-hidden
          />
        )}
      </span>
      <span className="text-right whitespace-nowrap tabular-nums">
        <span className="text-muted-foreground text-xs">peak </span>
        <span className={cn(row.overCeiling && "font-medium")}>{row.maxHr ?? "–"}</span>
      </span>
    </li>
  );
}

function QuietRow({ row }: { row: IntervalRow }) {
  const drop =
    row.kind === "walk" && row.hrIn !== null && row.hrOut !== null
      ? `${row.hrIn} → ${row.hrOut}`
      : null;
  return (
    <li className="text-muted-foreground grid grid-cols-[4.5rem_2.5rem_minmax(0,1fr)] items-center gap-2 pb-1 text-xs">
      <span>{row.label}</span>
      <span
        className={cn("tabular-nums", row.kind === "walk" && !row.onTime && "text-status-warning")}
      >
        {row.time}
      </span>
      <span className="tabular-nums">{drop ? `HR ${drop}` : row.pace}</span>
    </li>
  );
}
