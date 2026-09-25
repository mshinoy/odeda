import { Link } from "react-router-dom";
import { KindBadge } from "@/components/KindBadge";
import { cellClass } from "@/features/activities/columns";
import type { ActivityRowView } from "@/features/activities/rowView";
import { cn } from "@/lib/utils";

const cell = "px-3 py-2.5";
const numericCell = cn(cell, "text-right whitespace-nowrap");

interface ActivityRowProps {
  row: ActivityRowView;
  /** Ticked for comparison. */
  selected: boolean;
  onSelect: (id: string) => void;
}

/** One activity. The whole row opens it; the name is the link, stretched over the row. */
export function ActivityRow({ row, selected, onSelect }: ActivityRowProps) {
  return (
    <tr className="hover:bg-muted/60 relative border-b transition-colors">
      {/* Above the row-wide link, so ticking a row does not open it. */}
      <td className={cn(cell, "relative z-10", cellClass("select"))}>
        <input
          type="checkbox"
          className="accent-foreground size-4 align-middle"
          aria-label={`Compare ${row.name}`}
          checked={selected}
          onChange={() => onSelect(row.id)}
        />
      </td>
      <td className={cn(cell, "text-muted-foreground", cellClass("date"))}>{row.date}</td>
      <td className={cn(cell, cellClass("name"))}>
        <Link
          to={row.href}
          className="focus-visible:after:ring-ring font-medium after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset"
        >
          {row.name}
        </Link>
        {row.race && (
          <span className="bg-muted text-muted-foreground ml-2 rounded-sm px-1.5 py-0.5 text-xs">
            Race
          </span>
        )}
      </td>
      <td className={cn(cell, cellClass("type"))}>
        <KindBadge kind={row.kind} label={row.typeLabel} />
      </td>
      {row.measure.kind === "gym" ? (
        <td colSpan={2} className={numericCell}>
          {row.measure.setsReps}
        </td>
      ) : (
        <>
          <td className={numericCell}>{row.measure.distance}</td>
          <td className={numericCell}>{row.measure.pace}</td>
        </>
      )}
      <td className={cn(numericCell, cellClass("time"))}>{row.time}</td>
      <td className={cn(numericCell, cellClass("hr"))}>{row.hr}</td>
    </tr>
  );
}
