// The per-sample metrics a map can colour by and a chart can plot, defined once so the
// map legend, the colour-by control and the charts agree on label, units and direction.
import type { ActivityStreams } from "@/api/adapters";
import type { ActivityKind } from "@/lib/activityKind";
import {
  formatElevation,
  formatHeartRate,
  formatKmh,
  formatKmhBare,
  formatPace,
  formatPaceClock,
  formatPer100m,
  formatPercent,
  formatSportSpeed,
} from "@/lib/format";

export type MetricKey = "pace" | "hr" | "elevation" | "gradient" | "headwind";

export interface MetricDefinition {
  key: MetricKey;
  /** 1-2 words, for toggles, axis names and legends. */
  label: string;
  /**
   * The column this metric scales on. Pace is scaled on speed, where higher means
   * harder, so every metric reads "high end of the ramp = more intense".
   */
  scaleValues: (streams: ActivityStreams) => (number | null)[];
  /** The column a chart plots. Pace is the exception: its column comes from `paceScale`. */
  plotValues: (streams: ActivityStreams) => (number | null)[];
  /** Which way up the axis reads. Pace is the exception again: see `paceScale`. */
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
  headwind: {
    key: "headwind",
    label: "Headwind",
    // Positive is into the wind, so the high end of the ramp is the hard end.
    scaleValues: (s) => s.headwindKmh ?? [],
    plotValues: (s) => s.headwindKmh ?? [],
    invertAxis: false,
    formatScaleValue: (kmh) =>
      Math.round(kmh) === 0
        ? formatKmh(0, 0)
        : `${formatKmh(Math.abs(kmh), 0)} ${kmh > 0 ? "head" : "tail"}`,
  },
};

/** The metrics with at least one value in these streams, in display order. */
export function availableMetrics(streams: ActivityStreams): MetricDefinition[] {
  return Object.values(metrics).filter((m) => m.scaleValues(streams).some((v) => v !== null));
}

// ---------------------------------------------------------------- the pace axis

/**
 * How a sport reads its own speed on a chart. Every sport is plotted from the same
 * smoothed metres per second, but a runner thinks in minutes per kilometre, a cyclist
 * in km/h and a swimmer in minutes per 100 m — and the first two run in opposite
 * directions, so the axis has to know which way up "faster" is.
 */
export interface PaceScale {
  /** "Pace" or "Speed": what this sport calls the metric. */
  label: string;
  /** What the chart plots, from `smoothSpeedMps`. */
  values: (streams: ActivityStreams) => (number | null)[];
  /** True for the time-per-distance units, where a smaller number belongs higher up. */
  invert: boolean;
  /** Whether ticks land on round seconds or round decimals. */
  seconds: boolean;
  /** The smallest y span worth showing, in the plotted unit. */
  minSpan: number;
  /** A plotted value with its unit: "5:12 /km", "19.3 km/h", "1:42 /100m". */
  format: (value: number) => string;
  /** The same without the unit, for the ticks that do not carry it. */
  formatBare: (value: number) => string;
}

const KMH_PER_MPS = 3.6;

const PACE_PER_KM: PaceScale = {
  label: "Pace",
  values: (s) => s.paceSPerKm,
  invert: true,
  seconds: true,
  minSpan: 30,
  format: formatPace,
  formatBare: formatPaceClock,
};

const PACE_PER_100M: PaceScale = {
  label: "Pace",
  values: (s) => s.smoothSpeedMps.map((mps) => (mps === null ? null : 100 / mps)),
  invert: true,
  seconds: true,
  // A pool set varies far less than a road run, so a tighter floor keeps the line real.
  minSpan: 20,
  format: formatPer100m,
  formatBare: formatPaceClock,
};

const SPEED_KMH: PaceScale = {
  label: "Speed",
  values: (s) => s.smoothSpeedMps.map((mps) => (mps === null ? null : mps * KMH_PER_MPS)),
  invert: false,
  seconds: false,
  minSpan: 2,
  format: formatKmh,
  formatBare: formatKmhBare,
};

/** The unit a sport's speed chart reads in. Matches `formatSportSpeed`. */
export function paceScale(kind: ActivityKind): PaceScale {
  switch (kind) {
    case "run":
    case "walk":
      return PACE_PER_KM;
    case "swim":
      return PACE_PER_100M;
    case "ride":
    case "strength":
    case "other":
      return SPEED_KMH;
  }
}

/** What a metric is called for this sport: only the pace metric changes its name. */
export function metricLabel(metric: MetricDefinition, kind: ActivityKind): string {
  return metric.key === "pace" ? paceScale(kind).label : metric.label;
}
