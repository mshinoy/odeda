import type { Delta, YearTableRow } from "@/features/trends/yearRow";
import { MISSING } from "@/lib/format";
import { cn } from "@/lib/utils";

const cell = "px-3 py-2.5";
const numericCell = cn(cell, "text-right whitespace-nowrap tabular-nums");
const headCell = "px-3 py-2 text-left font-normal text-muted-foreground";
const numericHead = cn(headCell, "text-right");
// The two secondary readings go when the screen cannot hold the whole row.
const wideOnly = "hidden md:table-cell";

const toneClass = {
  good: "text-delta-good",
  bad: "text-delta-bad",
} as const;

/**
 * Each year against the one before it. Pace is a column only when one sport is being
 * shown — `toYearTableRows` decides that and leaves the cell null otherwise.
 */
export function YearOverYearTable({ rows }: { rows: readonly YearTableRow[] }) {
  const showPace = rows.some((row) => row.pace !== null);

  return (
    <table className="w-full text-sm">
      <thead className="border-b">
        <tr>
          <th className={cn(headCell, "w-full")}>Year</th>
          <th className={numericHead}>Activities</th>
          <th className={numericHead}>Distance</th>
          <th className={numericHead}>vs prev</th>
          <th className={numericHead}>Time</th>
          <th className={numericHead}>vs prev</th>
          {showPace && <th className={numericHead}>Pace</th>}
          {showPace && <th className={numericHead}>vs prev</th>}
          <th className={cn(numericHead, wideOnly)}>Avg HR</th>
          <th className={cn(numericHead, wideOnly)}>Elevation</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.year} className="border-b">
            <td className={cn(cell, "font-medium tabular-nums")}>{row.year}</td>
            <td className={numericCell}>{row.activities}</td>
            <td className={numericCell}>{row.distance}</td>
            <DeltaCell delta={row.distanceDelta} />
            <td className={numericCell}>{row.hours}</td>
            <DeltaCell delta={row.hoursDelta} />
            {showPace && <td className={numericCell}>{row.pace}</td>}
            {showPace && <DeltaCell delta={row.paceDelta} />}
            <td className={cn(numericCell, wideOnly, "text-muted-foreground")}>{row.avgHr}</td>
            <td className={cn(numericCell, wideOnly, "text-muted-foreground")}>{row.elevation}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function DeltaCell({ delta }: { delta: Delta | null }) {
  if (delta === null)
    return <td className={cn(numericCell, "text-muted-foreground")}>{MISSING}</td>;
  return <td className={cn(numericCell, toneClass[delta.tone])}>{delta.text}</td>;
}
