import { Link } from "react-router-dom";
import type { PersonalBestRow } from "@/features/trends/personalBestRow";
import { MISSING } from "@/lib/format";
import { cn } from "@/lib/utils";

const cell = "px-3 py-2.5";
const numericCell = cn(cell, "text-right whitespace-nowrap tabular-nums");
const headCell = "px-3 py-2 text-left font-normal text-muted-foreground";
const numericHead = cn(headCell, "text-right");
// The 90-day column is the secondary reading; it goes when the screen cannot hold both.
const wideOnly = "hidden md:table-cell";
const linkClass = "underline-offset-4 hover:underline";

/**
 * Your fastest time at each standard distance, and what you have managed at it in the
 * last 90 days. Both columns link to the run that set them.
 */
export function PersonalBestTable({ rows }: { rows: readonly PersonalBestRow[] }) {
  return (
    <table className="w-full text-sm">
      <thead className="border-b">
        <tr>
          <th className={cn(headCell, "w-full")}>Distance</th>
          <th className={numericHead}>Best</th>
          <th className={numericHead}>Pace</th>
          <th className={numericHead}>When</th>
          <th className={cn(numericHead, wideOnly, "whitespace-nowrap")}>Last 90 days</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.distanceM} className="border-b">
            <td className={cn(cell, "font-medium")}>{row.label}</td>
            <td className={numericCell}>{row.time}</td>
            <td className={cn(numericCell, "text-muted-foreground")}>{row.pace}</td>
            <td className={numericCell}>
              <Link to={row.href} className={linkClass}>
                {row.when}
              </Link>
            </td>
            <td className={cn(numericCell, wideOnly)}>
              {row.recentHref === null ? (
                MISSING
              ) : (
                <Link to={row.recentHref} className={linkClass}>
                  {row.recent}
                </Link>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
