import { useQuery } from "@tanstack/react-query";
import { toRouteDetail, toRouteSegments } from "@/api/adapters";
import { api, unwrap } from "@/api/client";
import { queryKeys } from "@/api/queryClient";

/** One route: its geometry, every attempt at it, and how those attempts have gone. */
/** `enabled` false holds the request back — the route list opens a card before it
 *  needs the detail, and 53 cards must not each fetch one on arrival. */
export function useRoute(id: number, enabled = true) {
  return useQuery({
    queryKey: queryKeys.route(id),
    queryFn: async () =>
      toRouteDetail(
        unwrap(await api.GET("/api/routes/{route_id}", { params: { path: { route_id: id } } })),
      ),
    enabled: enabled && Number.isInteger(id),
  });
}

/**
 * The speed-up/slow-down profile. Keyed apart from the route: renaming a route does
 * not move its segments, and only a re-cluster recomputes them.
 */
export function useRouteSegments(id: number) {
  return useQuery({
    queryKey: queryKeys.routeSegments(id),
    queryFn: async () =>
      toRouteSegments(
        unwrap(
          await api.GET("/api/routes/{route_id}/segments", {
            params: { path: { route_id: id } },
          }),
        ),
      ),
    enabled: Number.isInteger(id),
  });
}
