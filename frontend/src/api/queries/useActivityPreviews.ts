import { useQuery } from "@tanstack/react-query";
import { toActivityPreviews } from "@/api/adapters";
import { api, unwrap } from "@/api/client";
import { queryKeys } from "@/api/queryClient";

/**
 * The routes for one page of activity cards. Asked for after the list arrives, so the
 * cards are drawn first and the maps fill in; a route only changes on a re-sync, so a
 * page already seen is not asked for again.
 */
export function useActivityPreviews(ids: readonly string[]) {
  return useQuery({
    queryKey: queryKeys.activityPreviews(ids),
    queryFn: async () =>
      toActivityPreviews(
        unwrap(await api.GET("/api/activities/previews", { params: { query: { ids: [...ids] } } })),
      ),
    enabled: ids.length > 0,
    staleTime: Infinity,
  });
}
