// The Health data types cut down to a window of days. Each keeps its parallel arrays in step.
import type { BodySeries } from "@/api/queries/useBody";
import type { DailyRow, MetricTrend, ReadinessPoint } from "@/api/queries/useHealth";
import { sliceRange, type DayWindow } from "@/charts/health/zoomWindow";

export function windowTrend(trend: MetricTrend, window: DayWindow | null): MetricTrend {
  if (window === null) return trend;
  const [start, end] = sliceRange(trend.days, window);
  const cut = <T>(values: readonly T[]) => values.slice(start, end);
  return {
    ...trend,
    days: cut(trend.days),
    values: cut(trend.values),
    roll7: cut(trend.roll7),
    roll28: cut(trend.roll28),
    roll90: cut(trend.roll90),
  };
}

export function windowRows(rows: readonly DailyRow[], window: DayWindow | null): DailyRow[] {
  if (window === null) return [...rows];
  const [start, end] = sliceRange(
    rows.map((row) => row.day),
    window,
  );
  return rows.slice(start, end);
}

export function windowReadiness(
  series: readonly ReadinessPoint[],
  window: DayWindow | null,
): ReadinessPoint[] {
  if (window === null) return [...series];
  const [start, end] = sliceRange(
    series.map((point) => point.day),
    window,
  );
  return series.slice(start, end);
}

export function windowBody(series: BodySeries, window: DayWindow | null): BodySeries {
  if (window === null) return series;
  const [start, end] = sliceRange(series.days, window);
  const cut = <T>(values: readonly T[]) => values.slice(start, end);
  return {
    ...series,
    days: cut(series.days),
    weight_kg: cut(series.weight_kg),
    trend_kg: cut(series.trend_kg),
    fat_kg: cut(series.fat_kg),
    lean_kg: cut(series.lean_kg),
    // Absent on an older payload; slicing an empty array is still empty.
    fat_pct: cut(series.fat_pct ?? []),
  };
}
