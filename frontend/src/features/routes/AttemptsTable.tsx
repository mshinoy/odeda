import { Link } from "react-router-dom";
import type { AttemptRowView } from "@/features/routes/attemptRowView";
import { cn } from "@/lib/utils";

const cell = "px-3 py-2.5";
const numericCell = cn(cell, "text-right whitespace-nowrap");
const headCell = "px-3 py-2 text-left font-normal text-muted-foreground";
const numericHead = cn(headCell, "text-right whitespace-nowrap");
const wideOnly = "hidden md:table-cell";

interface AttemptsTableProps {
  rows: readonly AttemptRowView[];
  /** Round a loop: the laps, the fastest of them, and how far behind the best lap. */
  loop: boolean;
}

/** Every attempt, newest first. The whole row opens the activity. */
export function AttemptsTable({ rows, loop }: AttemptsTableProps) {
  return (
    <table className="w-full text-sm">
      <thead className="border-b">
        <tr>
          <th className={cn(headCell, "whitespace-nowrap")}>Date</th>
          <th className={cn(headCell, "w-full")}>Activity</th>
          {loop && <th className={numericHead}>Laps</th>}
          {loop && <th className={numericHead}>Best lap</th>}
          <th className={cn(numericHead, wideOnly)}>Distance</th>
          <th className={cn(numericHead, loop && wideOnly)}>Time</th>
          <th className={numericHead}>{loop ? "Behind best lap" : "Behind best"}</th>
          <th className={cn(numericHead, wideOnly)}>Pace</th>
          <th className={cn(numericHead, wideOnly)}>Avg HR</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <AttemptRow key={row.id} row={row} loop={loop} />
        ))}
      </tbody>
    </table>
  );
}

function AttemptRow({ row, loop }: { row: AttemptRowView; loop: boolean }) {
  return (
    <tr
      className={cn(
        "hover:bg-muted/60 relative border-b transition-colors",
        row.excluded && "text-muted-foreground",
      )}
    >
      <td className={cn(cell, "text-muted-foreground whitespace-nowrap")}>{row.date}</td>
      <td className={cell}>
        <Link
          to={row.href}
          className="focus-visible:after:ring-ring font-medium after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset"
        >
          {row.name}
        </Link>
        {row.best && <Tag>Best</Tag>}
        {row.excluded && <Tag>Excluded</Tag>}
      </td>
      {loop && <td className={numericCell}>{row.laps}</td>}
      {loop && <td className={numericCell}>{row.bestLap}</td>}
      <td className={cn(numericCell, wideOnly)}>{row.distance}</td>
      <td className={cn(numericCell, loop && wideOnly)}>{row.time}</td>
      <td className={cn(numericCell, "text-muted-foreground")}>{row.behind}</td>
      <td className={cn(numericCell, wideOnly)}>{row.pace}</td>
      <td className={cn(numericCell, wideOnly)}>{row.hr}</td>
    </tr>
  );
}

function Tag({ children }: { children: string }) {
  return (
    <span className="bg-muted text-muted-foreground ml-2 rounded-sm px-1.5 py-0.5 text-xs">
      {children}
    </span>
  );
}
