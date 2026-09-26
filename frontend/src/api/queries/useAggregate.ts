// The Trends aggregates: lifetime totals, per-period totals, year over year, and the
// distributions, patterns, streaks and records behind them, in one round trip. Every
// block answers to the same type, date and gear filters.
import { useQuery } from "@tanstack/react-query";
import { api, unwrap } from "@/api/client";
import { queryKeys, type AggregateParams } from "@/api/queryClient";
import type { components } from "@/api/schema";

export type Aggregate = components["schemas"]["Aggregate"];
export type LifetimeTotals = components["schemas"]["LifetimeTotals"];
export type PeriodRow = components["schemas"]["PeriodRow"];
export type YearRow = components["schemas"]["YearRow"];
export type YearOverYear = components["schemas"]["YearOverYear"];
export type MetricChange = components["schemas"]["MetricChange"];
export type AggregateStreaks = components["schemas"]["AggregateStreaks"];
export type Records = components["schemas"]["Records"];
export type Extreme = components["schemas"]["Extreme"];

export function useAggregate(params: AggregateParams = {}) {
  return useQuery({
    queryKey: queryKeys.aggregate(params),
    queryFn: async () => unwrap(await api.GET("/api/aggregate", { params: { query: params } })),
  });
}

/** The filter bar's options: the types recorded, the gear owned, and the day range. */
export function useAggregateFilters() {
  return useQuery({
    queryKey: queryKeys.aggregateFilters,
    queryFn: async () => unwrap(await api.GET("/api/aggregate/filters")),
  });
}
