import { Link } from "react-router-dom";
import type { CompareRow } from "@/features/compare/compareRows";
import { cn } from "@/lib/utils";

const cell = "px-3 py-2.5";
const numericCell = cn(cell, "text-right whitespace-nowrap");
const headCell = "px-3 py-2 text-left font-normal text-muted-foreground whitespace-nowrap";
const numericHead = cn(headCell, "text-right");

/** The compared activities and what each one's colour means. This is the legend. */
export function CompareTable({ rows }: { rows: readonly CompareRow[] }) {
  return (
    <table className="w-full text-sm">
      <thead className="border-b">
        <tr>
          <th className={cn(headCell, "w-full")}>Activity</th>
          <th className={numericHead}>Distance</th>
          <th className={numericHead}>Time</th>
          <th className={numericHead}>Pace</th>
          <th className={numericHead}>Avg HR</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id} className="hover:bg-muted/60 relative border-b transition-colors">
            <td className={cell}>
              <span className="inline-flex items-center gap-2">
                <span
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: row.color }}
                  aria-hidden
                />
                <Link
                  to={row.href}
                  className="focus-visible:after:ring-ring font-medium after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset"
                >
                  {row.name}
                </Link>
                <span className="text-muted-foreground">{row.date}</span>
              </span>
            </td>
            <td className={numericCell}>{row.distance}</td>
            <td className={numericCell}>{row.time}</td>
            <td className={numericCell}>{row.pace}</td>
            <td className={numericCell}>{row.hr}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
