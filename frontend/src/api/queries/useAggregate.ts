// The Trends aggregates: lifetime totals, per-period totals, year over year, and the
// distributions, patterns, streaks and records behind them, in one round trip.
// The endpoint takes type, date and gear filters; nothing passes any yet (T10c).
import { useQuery } from "@tanstack/react-query";
import { api, unwrap } from "@/api/client";
import { queryKeys } from "@/api/queryClient";
import type { components } from "@/api/schema";

export type Aggregate = components["schemas"]["Aggregate"];
export type LifetimeTotals = components["schemas"]["LifetimeTotals"];
export type PeriodRow = components["schemas"]["PeriodRow"];
export type YearRow = components["schemas"]["YearRow"];
export type YearOverYear = components["schemas"]["YearOverYear"];
export type MetricChange = components["schemas"]["MetricChange"];

export function useAggregate() {
  return useQuery({
    queryKey: queryKeys.aggregate,
    queryFn: async () => unwrap(await api.GET("/api/aggregate")),
  });
}
