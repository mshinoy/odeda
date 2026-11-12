// The rows of the "Details" popup: everything the page used to show as six big numbers and
// the list shows on its cards, kept one click away. Pure, and left out when empty.
import type { Activity, ActivityStreams } from "@/api/adapters";
import type { ActivityKind } from "@/lib/activityKind";
import {
  formatDecimal,
  formatDuration,
  formatElevation,
  formatHeartRate,
  formatInteger,
  formatPercent,
  formatWithUnit,
} from "@/lib/format";

export interface DetailRow {
  label: string;
  value: string;
  /** One line on what it means, where the number is not self-explanatory. */
  note?: string;
}

/**
 * Steps or revolutions a minute, over the samples that moved. Null with none. Only for an
 * activity with no summary figure: the stream is not always in the same unit as the watch's
 * own average (a run's per-foot count reads half of it), so the watch's number wins.
 */
export function averageCadence(streams: ActivityStreams): number | null {
  const moving = streams.cadenceSpm.filter((c): c is number => c !== null && c > 0);
  if (moving.length === 0) return null;
  return moving.reduce((a, b) => a + b, 0) / moving.length;
}

/** Aerobic drift below this is a steady effort; above it, the heart rate was chasing the pace. */
const STEADY_DRIFT_PCT = 5;

function cadenceUnit(kind: ActivityKind): string {
  return kind === "ride" ? "rpm" : "spm";
}

export function detailRows(activity: Activity): DetailRow[] {
  const { summary, streams, decouplingPct } = activity;
  const rows: DetailRow[] = [];
  const add = (label: string, value: string | null, note?: string) => {
    if (value !== null) rows.push(note ? { label, value, note } : { label, value });
  };

  add("Elapsed time", summary.durationS ? formatDuration(summary.durationS) : null);
  add("Moving time", summary.movingTimeS ? formatDuration(summary.movingTimeS) : null);
  add("Climb", summary.elevationGainM !== null ? formatElevation(summary.elevationGainM) : null);
  const cadence = summary.avgCadenceSpm ?? averageCadence(streams);
  add("Cadence", cadence === null ? null : formatWithUnit(cadence, cadenceUnit(summary.kind), 0));
  add("Highest heart rate", summary.maxHr !== null ? formatHeartRate(summary.maxHr) : null);
  add("Calories", summary.calories ? formatInteger(summary.calories) : null);
  add("TRIMP", summary.trimp !== null ? formatInteger(summary.trimp) : null, "Training load");
  add(
    "Training effect",
    summary.trainingEffect !== null ? formatDecimal(summary.trainingEffect) : null,
  );
  add(
    "Heart-rate drift",
    decouplingPct === null ? null : formatPercent(decouplingPct, 1),
    decouplingPct === null
      ? undefined
      : decouplingPct <= STEADY_DRIFT_PCT
        ? "Steady: heart rate stayed with the pace."
        : "Heart rate rose against the pace as it went on.",
  );
  return rows;
}
