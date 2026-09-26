import type { SyncEstimate } from "@/api/queries/useSettings";
import { formatDate, formatInteger, formatRoughDuration } from "@/lib/format";

/**
 * The estimate as one sentence and a range.
 *
 * The backend reports a low and a high on purpose: the per-request delay dominates
 * and Garmin's throttling is not predictable. Showing the midpoint would read as a
 * promise, so both ends are shown.
 */
export function formatEstimateRange(estimate: SyncEstimate): string {
  const low = formatRoughDuration(estimate.estimated_seconds_low);
  const high = formatRoughDuration(estimate.estimated_seconds_high);
  return low === high ? low : `${low} – ${high}`;
}

export interface EstimateFact {
  label: string;
  value: string;
}

export function estimateFacts(estimate: SyncEstimate): EstimateFact[] {
  return [
    {
      label: "History",
      value: `${formatDate(estimate.first_day)} → ${formatDate(estimate.last_day)}`,
    },
    { label: "Days", value: formatInteger(estimate.days) },
    { label: "Requests", value: formatInteger(estimate.estimated_requests) },
    {
      label: "Streams to fetch",
      value: formatInteger(estimate.activities_pending_details),
    },
  ];
}
