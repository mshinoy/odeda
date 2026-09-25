import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toRouteList, toRouteOptions } from "@/api/adapters";
import { api, unwrap } from "@/api/client";
import { queryKeys } from "@/api/queryClient";

// Unfiltered, so one fetch serves every reader of it. The payload is what is cached and
// `select` is what differs, because the two readers want different shapes of the same
// rows and a second queryFn under this key would fight the first over the cache.
const routesQuery = { queryKey: queryKeys.routes, queryFn: fetchRoutes } as const;

async function fetchRoutes() {
  return unwrap(await api.GET("/api/routes"));
}

/** Every clustered route as a select's options; skipped for an activity that cannot be on one. */
export function useRoutes(enabled = true) {
  return useQuery({ ...routesQuery, select: toRouteOptions, enabled });
}

/** Every clustered route as the route list shows it, busiest first. */
export function useRouteList() {
  return useQuery({ ...routesQuery, select: toRouteList });
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
