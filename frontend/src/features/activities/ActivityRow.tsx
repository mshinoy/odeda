import { Link } from "react-router-dom";
import { KindBadge } from "@/components/KindBadge";
import { cellClass } from "@/features/activities/columns";
import type { ActivityRowView } from "@/features/activities/rowView";
import { cn } from "@/lib/utils";

const cell = "px-3 py-2.5";
const numericCell = cn(cell, "text-right whitespace-nowrap");

/** One activity. The whole row opens it; the name is the link, stretched over the row. */
export function ActivityRow({ row }: { row: ActivityRowView }) {
  return (
    <tr className="hover:bg-muted/60 relative border-b transition-colors">
      <td className={cn(cell, "text-muted-foreground", cellClass("date"))}>{row.date}</td>
      <td className={cn(cell, cellClass("name"))}>
        <Link
          to={row.href}
          className="focus-visible:after:ring-ring font-medium after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset"
        >
          {row.name}
        </Link>
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
