import { RotateCcw } from "lucide-react";
import { NativeSelect } from "@/components/NativeSelect";
import { relabelOptions, type ExerciseRow } from "@/features/activity/gym/gymSession";
import type { ExerciseComparison } from "@/features/activity/gym/gymAnswers";
import { formatInteger, formatVolume, MISSING } from "@/lib/format";
import { cn } from "@/lib/utils";

interface ExerciseListProps {
  rows: readonly ExerciseRow[];
  comparisons: readonly ExerciseComparison[];
  /** Rows to mark: the hovered one, or every row training the hovered muscle. */
  highlighted: ReadonlySet<number>;
  onHover: (index: number | null) => void;
  /** Says what an exercise really was. `label` is `CATEGORY` or `CATEGORY/SUB`. */
  onRelabel: (index: number, label: string) => void;
  /** Puts Garmin's own guess back. */
  onRevert: (index: number) => void;
  busy: boolean;
}

const TONE: Record<ExerciseComparison["tone"], string> = {
  up: "text-delta-good",
  down: "text-delta-bad",
  same: "text-muted-foreground",
  none: "text-muted-foreground",
};

const COLUMNS =
  "grid grid-cols-2 items-center gap-x-4 gap-y-2 sm:grid-cols-[minmax(0,1.4fr)_5.5rem_minmax(0,1.5fr)_6rem_8rem] sm:gap-5";

/**
 * What was lifted, each exercise with its heaviest set as a bar and how that compares with
 * the last time it was done. An exercise Garmin could not name asks to be named, and naming
 * it is what gives it a history to compare with.
 */
export function ExerciseList({
  rows,
  comparisons,
  highlighted,
  onHover,
  onRelabel,
  onRevert,
  busy,
}: ExerciseListProps) {
  return (
    <div className="flex flex-col">
      <div className={cn(COLUMNS, "text-muted-foreground hidden px-6 pb-2 text-xs sm:grid")}>
        <span>Exercise</span>
        <span>Sets · reps</span>
        <span>Heaviest set</span>
        <span className="text-right">Volume</span>
        <span className="text-right">Last time</span>
      </div>
      {rows.map((row) => {
        const compare = comparisons.find((c) => c.index === row.index);
        return (
          <div
            key={row.index}
            className={cn(
              COLUMNS,
              "border-t px-6 py-3.5 transition-colors duration-150",
              highlighted.has(row.index) && "bg-muted",
              row.unlabelled && "bg-status-warning/10",
            )}
            onPointerEnter={() => onHover(row.index)}
            onPointerLeave={() => onHover(null)}
          >
            <div className="col-span-2 flex min-w-0 flex-col items-start gap-0.5 sm:col-span-1">
              <NativeSelect
                aria-label={`Exercise ${row.index + 1}`}
                value={row.label}
                disabled={busy}
                className={cn(
                  "-ml-2 h-8 max-w-full border-transparent bg-transparent px-2 text-base font-medium",
                  "hover:border-input focus-visible:border-input dark:bg-transparent",
                  row.unlabelled &&
                    "border-status-warning/60 text-muted-foreground border-dashed italic",
                )}
                onChange={(event) => onRelabel(row.index, event.target.value)}
              >
                {relabelOptions(row).map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </NativeSelect>
              {row.edited && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onRevert(row.index)}
                  className="text-muted-foreground hover:text-foreground inline-flex min-w-0 items-center gap-1 text-xs transition-colors disabled:opacity-50"
                >
                  <RotateCcw className="size-3 shrink-0" aria-hidden />
                  <span className="truncate">Garmin: {row.garminName}</span>
                </button>
              )}
            </div>
            <span className="text-ink-secondary order-3 text-sm tabular-nums sm:order-none">
              {formatInteger(row.sets)} · {formatInteger(row.reps)}
            </span>
            <div className="order-2 col-span-2 flex items-center gap-3 sm:order-none sm:col-span-1">
              <span className="bg-muted h-2.5 flex-1 overflow-hidden rounded-full">
                {compare?.barPct != null && (
                  <span
                    className="bg-kind-strength block h-full rounded-full"
                    style={{ width: `${compare.barPct}%` }}
                  />
                )}
              </span>
              <span className="w-14 text-sm tabular-nums">{compare?.weight ?? MISSING}</span>
            </div>
            <span className="order-4 text-right text-sm tabular-nums sm:order-none">
              {row.volumeG === null ? MISSING : formatVolume(row.volumeG)}
            </span>
            <span className="order-5 col-span-2 flex flex-row items-baseline gap-2 text-sm sm:order-none sm:col-span-1 sm:flex-col sm:items-end sm:gap-0">
              <span className={cn("font-medium", compare ? TONE[compare.tone] : "")}>
                {compare?.change ?? MISSING}
              </span>
              {compare?.since && (
                <span className="text-muted-foreground text-xs">since {compare.since}</span>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}
