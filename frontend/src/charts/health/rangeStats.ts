// The numbers under a Health chart: what the window, or the stretch the user selected,
// came to. Pure, and computed from the daily data rather than from what is drawn, so a
// weekly-mean chart still reports the real daily low and high.
import type { BodySeries } from "@/api/queries/useBody";
import type { DailyRow, MetricTrend, ReadinessPoint } from "@/api/queries/useHealth";
import { scaled, type HealthMetric } from "@/features/health/healthMetrics";
import { nightTotalH, sleepNights } from "@/features/health/sleepStages";
import { changeFromStart } from "@/charts/body/buildMassSplitOption";
import { formatSigned, formatWithUnit, MISSING } from "@/lib/format";

export interface Stat {
  label: string;
  value: string;
}

interface Format {
  unit: string;
  digits: number;
}

function present(values: readonly (number | null | undefined)[]): number[] {
  return values.filter((value): value is number => value !== null && value !== undefined);
}

function mean(values: readonly (number | null | undefined)[]): number | null {
  const found = present(values);
  return found.length === 0 ? null : found.reduce((sum, value) => sum + value, 0) / found.length;
}

function withUnit({ unit, digits }: Format, value: number | null): string {
  return value === null ? MISSING : formatWithUnit(value, unit, digits);
}

function signedWithUnit({ unit, digits }: Format, value: number | null): string {
  if (value === null) return MISSING;
  const number = formatSigned(value, digits);
  return unit === "" ? number : `${number} ${unit}`;
}

/** Last present value minus the first: how far a series moved across the window. */
export function movement(values: readonly (number | null | undefined)[]): number | null {
  const found = present(values);
  const first = found[0];
  const last = found[found.length - 1];
  return first === undefined || last === undefined ? null : last - first;
}

function spread(label: string, values: readonly (number | null)[], format: Format): Stat[] {
  const found = present(values);
  return [
    { label: `Avg ${label}`.trim(), value: withUnit(format, mean(found)) },
    { label: "Low", value: withUnit(format, found.length ? Math.min(...found) : null) },
    { label: "High", value: withUnit(format, found.length ? Math.max(...found) : null) },
  ];
}

function days(count: number, noun = "Days"): Stat {
  return { label: noun, value: String(count) };
}

export function summarizeMetric(trend: MetricTrend, metric: HealthMetric): Stat[] {
  const format = { unit: metric.unit, digits: metric.digits };
  const values = trend.values.map((value) => scaled(value, metric));
  const baseline = trend.roll28.map((value) => scaled(value, metric));
  return [
    days(present(values).length, "Readings"),
    ...spread("", values, format),
    { label: "28-day change", value: signedWithUnit(format, movement(baseline)) },
  ];
}

export function summarizeSleep(rows: readonly DailyRow[]): Stat[] {
  const nights = sleepNights(rows);
  const hours = { unit: "h", digits: 1 };
  const stage = (pick: (night: (typeof nights)[number]) => number | null) =>
    withUnit(hours, mean(nights.map(pick)));
  return [
    days(nights.filter((night) => nightTotalH(night) !== null).length, "Nights"),
    { label: "Avg sleep", value: withUnit(hours, mean(nights.map(nightTotalH))) },
    { label: "Deep", value: stage((night) => night.deepH) },
    { label: "REM", value: stage((night) => night.remH) },
    { label: "Light", value: stage((night) => night.lightH) },
  ];
}

export function summarizeBodyBattery(rows: readonly DailyRow[]): Stat[] {
  const format = { unit: "", digits: 0 };
  const highs = rows.map((row) => row.bb_high);
  const lows = rows.map((row) => row.bb_low);
  const found = present(highs);
  const floor = present(lows);
  return [
    { label: "Avg high", value: withUnit(format, mean(highs)) },
    { label: "Avg low", value: withUnit(format, mean(lows)) },
    { label: "Best high", value: withUnit(format, found.length ? Math.max(...found) : null) },
    { label: "Worst low", value: withUnit(format, floor.length ? Math.min(...floor) : null) },
  ];
}

export function summarizeReadiness(series: readonly ReadinessPoint[]): Stat[] {
  const scores = series.map((point) => point.score);
  return [
    days(present(scores).length, "Scored days"),
    ...spread("", scores, { unit: "", digits: 0 }),
  ];
}

export function summarizeWeight(series: BodySeries): Stat[] {
  const kg = { unit: "kg", digits: 1 };
  return [
    days(present(series.weight_kg).length, "Weigh-ins"),
    ...spread("", series.weight_kg, kg),
    { label: "Trend change", value: signedWithUnit(kg, movement(series.trend_kg)) },
  ];
}

export function summarizeFatPct(series: BodySeries): Stat[] {
  const pct = { unit: "%", digits: 1 };
  const values = series.fat_pct ?? [];
  return [
    ...spread("", values, pct),
    { label: "Change", value: signedWithUnit({ unit: "pts", digits: 1 }, movement(values)) },
  ];
}

export function summarizeMass(series: BodySeries): Stat[] {
  const kg = { unit: "kg", digits: 1 };
  const lastOf = (values: readonly (number | null)[]) => present(values).pop() ?? null;
  return [
    { label: "Lean change", value: signedWithUnit(kg, movement(changeFromStart(series.lean_kg))) },
    { label: "Fat change", value: signedWithUnit(kg, movement(changeFromStart(series.fat_kg))) },
    { label: "Lean now", value: withUnit(kg, lastOf(series.lean_kg)) },
    { label: "Fat now", value: withUnit(kg, lastOf(series.fat_kg)) },
  ];
}
