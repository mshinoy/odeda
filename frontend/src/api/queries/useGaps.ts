import { useQuery } from "@tanstack/react-query";
import { toActivityGaps, type ActivityGap } from "@/api/adapters";
import { api, unwrap } from "@/api/client";
import { queryKeys } from "@/api/queryClient";

/**
 * Where the watch paused and resumed somewhere else, and a guess at the path in between.
 * Empty for most activities. Cached for the session, like the samples it comes from.
 */
export function useActivityGaps(id: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.gaps(id),
    queryFn: async (): Promise<ActivityGap[]> =>
      toActivityGaps(
        unwrap(
          await api.GET("/api/activities/{activity_id}/gaps", {
            params: { path: { activity_id: id } },
          }),
        ),
      ),
    enabled,
    staleTime: Infinity,
  });
}
