import { useQuery } from "@tanstack/react-query";
import { toCompare } from "@/api/adapters";
import { api, unwrap } from "@/api/client";
import { queryKeys } from "@/api/queryClient";

/**
 * Two to five activities' tracks and streams in one fetch. Samples never change after
 * a sync, so the answer is cached for the session, like a single activity's streams.
 */
export function useCompare(ids: readonly string[]) {
  return useQuery({
    queryKey: queryKeys.compare(ids),
    queryFn: async () =>
      toCompare(
        unwrap(
          await api.GET("/api/routes/compare/tracks", {
            params: { query: { ids: ids.join(",") } },
          }),
        ),
      ),
    enabled: ids.length > 0,
    staleTime: Infinity,
  });
}
