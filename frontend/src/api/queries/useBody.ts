// Body composition: the weigh-in trend, the fat/lean split, and what they look like
// against the training. One query, on the same window as the rest of Health, so the
// weight chart and the HRV chart always describe the same stretch of time.
import { useQuery } from "@tanstack/react-query";
import { api, unwrap } from "@/api/client";
import { queryKeys } from "@/api/queryClient";
import type { components } from "@/api/schema";

export type BodyComposition = components["schemas"]["BodyComposition"];
export type BodySeries = components["schemas"]["BodySeries"];
export type BodyConsistency = components["schemas"]["BodyConsistency"];
export type BodyLatest = components["schemas"]["BodyLatest"];
export type RaceWeightProjection = components["schemas"]["RaceWeightProjection"];
export type WeightLoadPoint = components["schemas"]["WeightLoadPoint"];
export type PowerToWeightPoint = components["schemas"]["PowerToWeightPoint"];
export type SpeedWeightPoint = components["schemas"]["SpeedWeightPoint"];

export function useBody(days: number) {
  return useQuery({
    queryKey: queryKeys.body(days),
    queryFn: async () => unwrap(await api.GET("/api/body", { params: { query: { days } } })),
  });
}
