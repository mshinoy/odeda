// The metrics the Health page shows, and how the latest one reads against its own
// trailing baseline. Pure: the cards and the charts both come through here, so a card
// and its chart can never disagree about a unit.
import type { MetricTrend, Trends, TrendMetricName } from "@/api/queries/useHealth";
import { formatDate, formatSigned, formatWithUnit } from "@/lib/format";

export interface HealthMetric {
  /** The `/api/trends` metric this reads. */
  key: TrendMetricName;
  /** 1-2 words, on the card and above the chart. */
  label: string;
  /** Stored unit → the unit shown: sleep is stored in seconds and read in hours. */
  scale: number;
  /** Written after the number, and once on the chart's top tick; "" when it has none. */
  unit: string;
  digits: number;
  /** The smallest y span, so a steady metric does not fill its chart with noise. */
  minSpan: number;
  /** The axis never runs below this: steps and stress cannot be negative, and padding made them. */
  floor?: number;
}

/** Read off the stacked stage chart, so it gets a card but no line of its own. */
export const SLEEP_DURATION_METRIC: HealthMetric = {
  key: "total_sleep_s",
  label: "Sleep",
  scale: 1 / 3600,
  unit: "h",
  digits: 1,
  minSpan: 2,
};

/** Read off the high/low chart, for the same reason. */
export const BODY_BATTERY_METRIC: HealthMetric = {
  key: "bb_high",
  label: "Body Battery",
  scale: 1,
  unit: "",
  digits: 0,
  minSpan: 20,
};

export const SLEEP_SCORE_METRIC: HealthMetric = {
  key: "sleep_score",
  label: "Sleep score",
  scale: 1,
  unit: "",
  digits: 0,
  minSpan: 20,
  floor: 0,
};

export const HRV_METRIC: HealthMetric = {
  key: "hrv",
  label: "HRV",
  scale: 1,
  unit: "ms",
  digits: 0,
  minSpan: 10,
  floor: 0,
};

export const RESTING_HR_METRIC: HealthMetric = {
  key: "resting_hr",
  label: "Resting HR",
  scale: 1,
  unit: "bpm",
  digits: 0,
  minSpan: 10,
};

export const STEPS_METRIC: HealthMetric = {
  key: "steps",
  label: "Steps",
  scale: 1,
  unit: "",
  digits: 0,
  // A quiet week still swings a couple of thousand steps a day; below this the chart
  // would be all noise and no shape.
  minSpan: 4000,
  floor: 0,
};

export const STRESS_METRIC: HealthMetric = {
  key: "stress_avg",
  label: "Stress",
  scale: 1,
  unit: "",
  digits: 0,
  minSpan: 10,
  floor: 0,
};

/** One sentence under each metric chart's title: what it is and how to read it. */
export const METRIC_DESCRIPTIONS: Partial<Record<TrendMetricName, string>> = {
  sleep_score: "Garmin's overnight sleep score out of 100. Higher is better.",
  hrv: "Overnight heart-rate variability. Higher than your baseline suggests good recovery.",
  resting_hr: "Resting heart rate each day. Lower than your baseline suggests good recovery.",
  steps: "Steps per day, with the 28-day baseline drawn over them.",
  stress_avg: "Average all-day stress, 0 to 100. Lower is calmer.",
};

/** The metrics with a chart of their own: the daily value and its 28-day baseline. */
export const CHART_METRICS: readonly HealthMetric[] = [
  SLEEP_SCORE_METRIC,
  HRV_METRIC,
  RESTING_HR_METRIC,
  // Both carried ~1,350 days of readings and had never been drawn.
  STEPS_METRIC,
  STRESS_METRIC,
];

/** The recovery card's row: how rested, and how the body is carrying it. */
export const RECOVERY_CARD_METRICS: readonly HealthMetric[] = [
  SLEEP_DURATION_METRIC,
  HRV_METRIC,
  RESTING_HR_METRIC,
  STRESS_METRIC,
  BODY_BATTERY_METRIC,
];

/** Every metric with a card, in the order the row shows them. */
export const CARD_METRICS: readonly HealthMetric[] = [
  SLEEP_DURATION_METRIC,
  ...CHART_METRICS,
  BODY_BATTERY_METRIC,
];

export type DeltaTone = "good" | "bad" | "neutral";

export interface BaselineCard {
  label: string;
  value: string;
  /** null when there is nothing to compare: no reading yet, or no baseline yet. */
  delta: string | null;
  tone: DeltaTone;
}

/** A stored value in the unit the metric is shown in. */
export function scaled(value: number | null, metric: HealthMetric): number | null {
  return value === null ? null : value * metric.scale;
}

/** Whether the window holds any reading at all. An empty metric is hidden, not shown empty. */
export function hasReadings(trend: MetricTrend | undefined): trend is MetricTrend {
  return trend !== undefined && trend.values.some((value) => value !== null);
}

/** The metrics in `list` that were recorded in this window, with their trend. */
export function recordedMetrics(
  list: readonly HealthMetric[],
  trends: Trends,
): { metric: HealthMetric; trend: MetricTrend }[] {
  return list.flatMap((metric) => {
    const trend = trends.metrics[metric.key];
    return hasReadings(trend) ? [{ metric, trend }] : [];
  });
}

/** The ones that were not, so the page can say so in one line instead of hiding silently. */
export function missingMetrics(list: readonly HealthMetric[], trends: Trends): HealthMetric[] {
  return list.filter((metric) => !hasReadings(trends.metrics[metric.key]));
}

/**
 * The latest value and how far it sits from its own trailing baseline.
 *
 * The difference is always shown, but it only takes a tone when the backend flagged it:
 * below that threshold the metric is inside its own normal spread, and colouring it
 * would read as news when there is none.
 */
export function baselineCard(metric: HealthMetric, trend: MetricTrend): BaselineCard {
  // Today's reading may not have synced: show the last one, and say which day it is.
  const last = trend.latest === null ? lastReading(trend) : null;
  const value = trend.latest ?? last?.value ?? null;
  const difference =
    value === null || trend.baseline_mean === null
      ? null
      : (value - trend.baseline_mean) * metric.scale;
  const vsBaseline =
    difference === null ? null : `${formatSigned(difference, metric.digits)} vs baseline`;

  return {
    label: metric.label,
    value: formatWithUnit(scaled(value, metric), metric.unit, metric.digits),
    delta: last
      ? [`last ${formatDate(last.day)}`, vsBaseline].filter(Boolean).join(" · ")
      : vsBaseline,
    tone: deltaTone(trend),
  };
}

/** The newest day with a reading, for a metric whose latest has not come in. */
function lastReading(trend: MetricTrend): { day: string; value: number } | null {
  for (let i = trend.values.length - 1; i >= 0; i--) {
    const value = trend.values[i];
    const day = trend.days[i];
    if (value !== null && value !== undefined && day !== undefined) return { day, value };
  }
  return null;
}

function deltaTone(trend: MetricTrend): DeltaTone {
  if (!trend.flagged) return "neutral";
  if (trend.verdict === "better than baseline") return "good";
  if (trend.verdict === "worse than baseline") return "bad";
  return "neutral";
}
