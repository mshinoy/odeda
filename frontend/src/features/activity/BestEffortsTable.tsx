import type { BestEffortRow } from "@/features/activity/activityDetails";

/** Fastest stretch of each standard distance inside this activity. */
export function BestEffortsTable({ rows }: { rows: readonly BestEffortRow[] }) {
  return (
    <table className="w-full max-w-md text-sm tabular-nums">
      <thead className="text-muted-foreground text-xs">
        <tr>
          <th className="pb-2 text-left font-normal">Distance</th>
          <th className="pb-2 text-right font-normal">Time</th>
          <th className="pb-2 text-right font-normal">Pace</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key} className="border-t">
            <td className="py-1.5">{row.distance}</td>
            <td className="py-1.5 text-right">{row.time}</td>
            <td className="text-muted-foreground py-1.5 text-right">{row.pace}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
