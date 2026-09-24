import type { ExerciseRow } from "@/features/activity/gym/gymSession";
import { formatInteger, formatVolume, formatWeight, MISSING } from "@/lib/format";
import { cn } from "@/lib/utils";

interface ExerciseTableProps {
  rows: readonly ExerciseRow[];
  /** Rows to mark: the hovered one, or every row training the hovered muscle. */
  highlighted: ReadonlySet<number>;
  onHover: (index: number | null) => void;
}

/** What was lifted, in the order Garmin recorded it. */
export function ExerciseTable({ rows, highlighted, onHover }: ExerciseTableProps) {
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
            <td className={cn("py-2", row.unlabelled && "text-muted-foreground italic")}>
              {row.name}
            </td>
            <td className="py-2 text-right tabular-nums">{formatInteger(row.sets)}</td>
            <td className="py-2 text-right tabular-nums">{formatInteger(row.reps)}</td>
            <td className="py-2 text-right tabular-nums">
              {row.maxWeightG === null ? MISSING : formatWeight(row.maxWeightG)}
            </td>
            <td className="py-2 text-right tabular-nums">
              {row.volumeG === null ? MISSING : formatVolume(row.volumeG)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
