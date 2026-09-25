import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { toHeatmap } from "@/api/adapters";
import { api, unwrap } from "@/api/client";
import { queryKeys, type HeatmapParams } from "@/api/queryClient";

/**
 * Every recorded GPS point, aggregated to a grid by the backend. The previous grid
 * stays on the map while a filter change loads, so the view does not go blank.
 */
export function useHeatmap(params: HeatmapParams) {
  return useQuery({
    queryKey: queryKeys.heatmap(params),
    queryFn: async () =>
      toHeatmap(unwrap(await api.GET("/api/heatmap", { params: { query: params } }))),
    placeholderData: keepPreviousData,
  });
}
