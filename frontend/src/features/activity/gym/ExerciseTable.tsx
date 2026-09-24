import { RotateCcw } from "lucide-react";
import { NativeSelect } from "@/components/NativeSelect";
import { relabelOptions, type ExerciseRow } from "@/features/activity/gym/gymSession";
import { formatInteger, formatVolume, formatWeight, MISSING } from "@/lib/format";
import { cn } from "@/lib/utils";

interface ExerciseTableProps {
  rows: readonly ExerciseRow[];
  /** Rows to mark: the hovered one, or every row training the hovered muscle. */
  highlighted: ReadonlySet<number>;
  onHover: (index: number | null) => void;
  /** Says what an exercise really was. `label` is `CATEGORY` or `CATEGORY/SUB`. */
  onRelabel: (index: number, label: string) => void;
  /** Puts Garmin's own guess back. */
  onRevert: (index: number) => void;
  busy: boolean;
}

/** What was lifted, in the order Garmin recorded it, each row relabellable. */
export function ExerciseTable({
  rows,
  highlighted,
  onHover,
  onRelabel,
  onRevert,
  busy,
}: ExerciseTableProps) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-muted-foreground border-b text-left text-xs">
          <th className="py-2 font-normal">Exercise</th>
          <th className="py-2 text-right font-normal">Sets</th>
          <th className="py-2 text-right font-normal">Reps</th>
          <th className="py-2 text-right font-normal">Max</th>
          <th className="py-2 text-right font-normal">Volume</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr
            key={row.index}
            className={cn(
              "border-b transition-colors duration-150 last:border-0",
              highlighted.has(row.index) && "bg-muted",
            )}
            onPointerEnter={() => onHover(row.index)}
            onPointerLeave={() => onHover(null)}
          >
            <td className="py-1.5">
              <div className="flex min-w-0 flex-col items-start gap-0.5">
                <NativeSelect
                  aria-label={`Exercise ${row.index + 1}`}
                  value={row.label}
                  disabled={busy}
                  // Borderless until it is pointed at: a table of selects would shout,
                  // and most rows are already right.
                  className={cn(
                    "-ml-2 h-7 max-w-full border-transparent bg-transparent px-2",
                    "hover:border-input focus-visible:border-input dark:bg-transparent",
                    row.unlabelled && "text-muted-foreground italic",
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
            </td>
            <td className="py-1.5 text-right tabular-nums">{formatInteger(row.sets)}</td>
            <td className="py-1.5 text-right tabular-nums">{formatInteger(row.reps)}</td>
            <td className="py-1.5 text-right tabular-nums">
              {row.maxWeightG === null ? MISSING : formatWeight(row.maxWeightG)}
            </td>
            <td className="py-1.5 text-right tabular-nums">
              {row.volumeG === null ? MISSING : formatVolume(row.volumeG)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
