// The per-sample metrics a map can colour by and a chart can plot, defined once so the
// map legend, the colour-by control and the charts agree on label, units and direction.
import type { ActivityStreams } from "@/api/adapters";
import type { ActivityKind } from "@/lib/activityKind";
import { formatElevation, formatHeartRate, formatPercent, formatSportSpeed } from "@/lib/format";

export type MetricKey = "pace" | "hr" | "elevation" | "gradient";

export interface MetricDefinition {
  key: MetricKey;
  /** 1-2 words, for toggles, axis names and legends. */
  label: string;
  /**
   * The column this metric scales on. Pace is scaled on speed, where higher means
   * harder, so every metric reads "high end of the ramp = more intense".
   */
  scaleValues: (streams: ActivityStreams) => (number | null)[];
  /** The column a chart plots (pace plots s/km with the axis inverted). */
  plotValues: (streams: ActivityStreams) => (number | null)[];
  /** Pace charts put faster (smaller s/km) at the top. */
  invertAxis: boolean;
  /** Formats a value from `scaleValues` for legends and tooltips. */
  formatScaleValue: (value: number, kind: ActivityKind) => string;
}

export const metrics: Record<MetricKey, MetricDefinition> = {
  pace: {
    key: "pace",
    label: "Pace",
    scaleValues: (s) => s.smoothSpeedMps,
    plotValues: (s) => s.paceSPerKm,
    invertAxis: true,
    formatScaleValue: (mps, kind) => formatSportSpeed(mps, kind),
  },
  hr: {
    key: "hr",
    label: "Heart rate",
    scaleValues: (s) => s.hr,
    plotValues: (s) => s.hr,
    invertAxis: false,
    formatScaleValue: (bpm) => formatHeartRate(bpm),
  },
  elevation: {
    key: "elevation",
    label: "Elevation",
    scaleValues: (s) => s.altitudeM,
    plotValues: (s) => s.altitudeM,
    invertAxis: false,
    formatScaleValue: (m) => formatElevation(m),
  },
  gradient: {
    key: "gradient",
    label: "Grade",
    scaleValues: (s) => s.gradientPct,
    plotValues: (s) => s.gradientPct,
    invertAxis: false,
    formatScaleValue: (pct) => formatPercent(pct, 0),
  },
};

/** The metrics with at least one value in these streams, in display order. */
export function availableMetrics(streams: ActivityStreams): MetricDefinition[] {
  return Object.values(metrics).filter((m) => m.scaleValues(streams).some((v) => v !== null));
}
