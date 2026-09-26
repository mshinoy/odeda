// Queries behind the Health page. All three take the same window, so the charts on the
// page always describe the same stretch of time. Server shapes are used as generated:
// the values are already in the units the charts plot.
import { useQuery } from "@tanstack/react-query";
import { api, unwrap } from "@/api/client";
import { queryKeys } from "@/api/queryClient";
import type { components } from "@/api/schema";

export type Trends = components["schemas"]["Trends"];
export type MetricTrend = components["schemas"]["MetricTrend"];
export type TrendMetricName = MetricTrend["metric"];
/** One day of `v_daily`, plus the light-sleep stage the view leaves out. */
export type DailyRow = components["schemas"]["DailySleepRow"];
export type ReadinessPoint = components["schemas"]["ReadinessPoint"];

export function useTrends(days: number) {
  return useQuery({
    queryKey: queryKeys.trends(days),
    queryFn: async () => unwrap(await api.GET("/api/trends", { params: { query: { days } } })),
  });
}

export function useDaily(days: number) {
  return useQuery({
    queryKey: queryKeys.daily(days),
    queryFn: async () => unwrap(await api.GET("/api/daily", { params: { query: { days } } })),
  });
}

export function useReadinessHistory(days: number) {
  return useQuery({
    queryKey: queryKeys.readinessHistory(days),
    queryFn: async () =>
      unwrap(await api.GET("/api/readiness/history", { params: { query: { days } } })),
  });
}
