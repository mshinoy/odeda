import { describe, expect, it } from "vitest";
import type { DailyRow, MetricTrend, Trends } from "@/api/queries/useHealth";
import {
  baselineCard,
  BODY_BATTERY_METRIC,
  CARD_METRICS,
  CHART_METRICS,
  hasReadings,
  HRV_METRIC,
  missingMetrics,
  recordedMetrics,
  RESTING_HR_METRIC,
  SLEEP_DURATION_METRIC,
} from "@/features/health/healthMetrics";
import {
  DEFAULT_HEALTH_RANGE,
  parseHealthRange,
  serializeHealthRange,
} from "@/features/health/healthRange";
import { hasSleepStages, nightTotalH, sleepNights } from "@/features/health/sleepStages";

const restingHr = RESTING_HR_METRIC;
const hrv = HRV_METRIC;

function trend(partial: Partial<MetricTrend> & Pick<MetricTrend, "metric">): MetricTrend {
  return {
    days: ["2026-09-23", "2026-09-24"],
    values: [56, 58],
    roll7: [56, 57],
    roll28: [56, 57],
    roll90: [56, 57],
    latest: 58,
    baseline_mean: 56,
    baseline_sd: 2,
    z: 1,
    flagged: false,
    verdict: "normal",
    ...partial,
  };
}

function trendsOf(...metrics: MetricTrend[]): Trends {
  return {
    metrics: Object.fromEntries(metrics.map((t) => [t.metric, t])),
    flags: [],
    baseline_days: 60,
    z_threshold: 1.5,
  };
}

describe("healthRange", () => {
  it("falls back to the default for anything it cannot read", () => {
    for (const raw of ["", "7", "nonsense", "365.5", "-90"]) {
      expect(parseHealthRange(new URLSearchParams(`days=${raw}`))).toBe(DEFAULT_HEALTH_RANGE);
    }
    expect(parseHealthRange(new URLSearchParams())).toBe(DEFAULT_HEALTH_RANGE);
  });

  it("round-trips a range through the URL and leaves the default out", () => {
    expect(serializeHealthRange(365).toString()).toBe("days=365");
    expect(parseHealthRange(new URLSearchParams("days=365"))).toBe(365);
    expect(serializeHealthRange(DEFAULT_HEALTH_RANGE).toString()).toBe("");
  });
});

describe("baselineCard", () => {
  it("shows the latest value in its own unit, and the gap to the baseline", () => {
    const card = baselineCard(restingHr, trend({ metric: "resting_hr" }));
    expect(card).toEqual({
      label: "Resting HR",
      value: "58 bpm",
      delta: "+2 vs baseline",
      tone: "neutral",
    });
  });

  it("reads sleep in hours, not the seconds it is stored in", () => {
    // 7.5 h against a 7.0 h baseline: 27,000 s against 25,200 s.
    const card = baselineCard(
      SLEEP_DURATION_METRIC,
      trend({ metric: "total_sleep_s", latest: 27000, baseline_mean: 25200 }),
    );
    expect(card.value).toBe("7.5 h");
    expect(card.delta).toBe("+0.5 vs baseline");
  });

  it("takes a tone only when the backend flagged the deviation", () => {
    const flagged = (verdict: MetricTrend["verdict"]) =>
      baselineCard(restingHr, trend({ metric: "resting_hr", flagged: true, verdict })).tone;
    expect(flagged("worse than baseline")).toBe("bad");
    expect(flagged("better than baseline")).toBe("good");
    expect(baselineCard(restingHr, trend({ metric: "resting_hr", z: 3 })).tone).toBe("neutral");
  });

  it("has no delta when there is no reading or no baseline", () => {
    const noReading = trend({ metric: "hrv", latest: null });
    const noBaseline = trend({ metric: "hrv", baseline_mean: null });
    expect(baselineCard(hrv, noReading).delta).toBeNull();
    expect(baselineCard(hrv, noReading).value).toBe("–");
    expect(baselineCard(hrv, noBaseline).delta).toBeNull();
  });
});

describe("which metrics the window recorded", () => {
  const recorded = trend({ metric: "resting_hr" });
  const empty = trend({ metric: "hrv", values: [null, null], latest: null });

  it("counts a metric as recorded only if some day has a value", () => {
    expect(hasReadings(recorded)).toBe(true);
    expect(hasReadings(empty)).toBe(false);
    expect(hasReadings(undefined)).toBe(false);
  });

  it("splits the metrics into charted and missing", () => {
    // The split is asserted, not the roster: this listed every metric by name and
    // broke the day steps and stress were added, which says nothing about the split.
    const trends = trendsOf(recorded, empty);
    const charted = recordedMetrics(CHART_METRICS, trends).map((m) => m.metric.key);
    const missing = missingMetrics(CHART_METRICS, trends).map((m) => m.key);

    expect(charted).toEqual(["resting_hr"]);
    // Present in the payload but with no readings in it, so it is missing, not charted.
    expect(missing).toContain("hrv");
    // Absent from the payload entirely — also missing.
    expect(missing).toContain("sleep_score");
    expect(missing).not.toContain("resting_hr");
    expect([...charted, ...missing].sort()).toEqual(CHART_METRICS.map((m) => m.key).sort());
  });

  it("gives Body Battery and sleep duration a card but no trend chart", () => {
    const cardKeys = CARD_METRICS.map((m) => m.key);
    const chartKeys = CHART_METRICS.map((m) => m.key);
    expect(cardKeys).toContain(BODY_BATTERY_METRIC.key);
    expect(cardKeys).toContain(SLEEP_DURATION_METRIC.key);
    expect(chartKeys).not.toContain(BODY_BATTERY_METRIC.key);
    expect(chartKeys).not.toContain(SLEEP_DURATION_METRIC.key);
  });
});

describe("sleepNights", () => {
  const rows: DailyRow[] = [
    {
      day: "2026-09-23",
      resting_hr: 56,
      steps: 3688,
      stress_avg: 28,
      bb_high: 61,
      bb_low: 10,
      bb_charged: 58,
      bb_drained: 55,
      total_sleep_s: 28680,
      sleep_score: null,
      deep_s: 540,
      rem_s: 7260,
      light_s: 20880,
      hrv: null,
      hrv_status: null,
      vo2max_run: 46,
      training_status: null,
      training_readiness: null,
      weight_kg: null,
    },
    {
      day: "2026-09-22",
      resting_hr: 62,
      steps: 12814,
      stress_avg: 43,
      bb_high: 72,
      bb_low: 6,
      bb_charged: 4,
      bb_drained: 37,
      total_sleep_s: null,
      sleep_score: null,
      deep_s: null,
      rem_s: null,
      light_s: null,
      hrv: null,
      hrv_status: null,
      vo2max_run: 46,
      training_status: null,
      training_readiness: null,
      weight_kg: null,
    },
  ];

  it("converts each stage to hours and leaves a night without stages null", () => {
    const [slept, missing] = sleepNights(rows);
    expect(slept).toEqual({
      day: "2026-09-23",
      deepH: 540 / 3600,
      remH: 7260 / 3600,
      lightH: 20880 / 3600,
    });
    // The three stages add up to `total_sleep_s`: 540 + 7,260 + 20,880 = 28,680 s.
    expect(slept && nightTotalH(slept)).toBeCloseTo(28680 / 3600, 10);
    expect(missing).toEqual({ day: "2026-09-22", deepH: null, remH: null, lightH: null });
    expect(missing && nightTotalH(missing)).toBeNull();
  });

  it("knows whether the window has any sleep to draw", () => {
    expect(hasSleepStages(sleepNights(rows))).toBe(true);
    expect(hasSleepStages(sleepNights(rows.slice(1)))).toBe(false);
    expect(hasSleepStages([])).toBe(false);
  });
});
