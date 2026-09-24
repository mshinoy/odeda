import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toRouteOptions } from "@/api/adapters";
import { api, unwrap } from "@/api/client";
import { queryKeys } from "@/api/queryClient";

/**
 * Every clustered route. Unfiltered, so one fetch serves any activity's select; skipped
 * for an activity that cannot be on one (`enabled`).
 */
export function useRoutes(enabled = true) {
  return useQuery({
    queryKey: queryKeys.routes,
    queryFn: async () => toRouteOptions(unwrap(await api.GET("/api/routes"))),
    enabled,
  });
}

/** Refiles an activity onto another route, by hand. */
export function useSetActivityRoute(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (routeId: number) =>
      unwrap(
        await api.PUT("/api/activities/{activity_id}/route", {
          params: { path: { activity_id: id } },
          body: { route_id: routeId },
        }),
      ),
    // Both routes it touched changed their attempt count, so the whole list refetches.
    onSuccess: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: queryKeys.activity(id) }),
        client.invalidateQueries({ queryKey: queryKeys.activitiesAll }),
        client.invalidateQueries({ queryKey: queryKeys.routes }),
      ]),
  });
}
