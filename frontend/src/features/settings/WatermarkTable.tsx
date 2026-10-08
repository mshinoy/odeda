import type { components } from "@/api/schema";
import { StatusDot } from "@/components/StatusDot";
import { formatAgo, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

type Watermark = components["schemas"]["Watermark"];

const cell = "px-3 py-2";
const numericCell = cn(cell, "text-right whitespace-nowrap tabular-nums");
const headCell = "px-3 py-2 text-left font-normal text-muted-foreground";
const numericHead = cn(headCell, "text-right");

/** A watermark's own status word, or "never" when the endpoint has not run. */
function tone(status: Watermark["status"]): "good" | "warning" | "critical" | "neutral" {
  if (status === "ok") return "good";
  if (status === "partial" || status === "rate_limited") return "warning";
  if (status === "error") return "critical";
  return "neutral";
}

/**
 * How far each endpoint has been synced.
 *
 * Every row in `sync_watermark`, whichever source wrote it: the Garmin endpoints, and
 * `fitbit_body` and `fitbit_export` since Phase 5. It takes no filter, so a new source
 * appears here the first time it runs without anything in this table changing.
 */
export function WatermarkTable({ watermarks }: { watermarks: readonly Watermark[] }) {
  if (watermarks.length === 0) {
    return <p className="text-muted-foreground text-sm">No endpoint has synced yet.</p>;
  }

  return (
    <table className="max-w-lg text-sm">
      <thead className="border-b">
        <tr>
          <th className={cn(headCell, "w-full")}>Endpoint</th>
          <th className={headCell}>State</th>
          <th className={numericHead}>Through</th>
          <th className={numericHead}>Ran</th>
        </tr>
      </thead>
      <tbody>
        {watermarks.map((mark) => (
          <tr key={mark.endpoint} className="border-b">
            <td className={cell}>{mark.endpoint}</td>
            <td className={cell}>
              <StatusDot tone={tone(mark.status)} label={mark.status ?? "never"} />
            </td>
            <td className={numericCell}>{formatDate(mark.last_day)}</td>
            <td className={cn(numericCell, "text-muted-foreground")}>
              {formatAgo(mark.last_run_at)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
