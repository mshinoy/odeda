import { Link } from "react-router-dom";
import type { ExtremeRow } from "@/features/trends/records";
import { cn } from "@/lib/utils";

const cell = "px-3 py-2.5";
const numericCell = cn(cell, "text-right whitespace-nowrap tabular-nums");
const headCell = "px-3 py-2 text-left font-normal text-muted-foreground";
const numericHead = cn(headCell, "text-right");
// The session's own name is the first thing to go when the row will not fit.
const wideOnly = "hidden md:table-cell";
const linkClass = "underline-offset-4 hover:underline";

/** The one session that tops the filtered set on each measure, each linking to itself. */
export function ExtremesTable({ rows }: { rows: readonly ExtremeRow[] }) {
  return (
    <table className="w-full text-sm">
      <thead className="border-b">
        <tr>
          <th className={cn(headCell, "w-full")}>Record</th>
          <th className={numericHead}>Value</th>
          <th className={cn(headCell, wideOnly)}>Session</th>
          <th className={numericHead}>When</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key} className="border-b">
            <td className={cn(cell, "font-medium")}>{row.label}</td>
            <td className={numericCell}>{row.value}</td>
            <td className={cn(cell, wideOnly, "text-muted-foreground")}>{row.activityName}</td>
            <td className={numericCell}>
              <Link to={row.href} className={linkClass}>
                {row.when}
              </Link>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
