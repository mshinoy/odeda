import { useQuery } from "@tanstack/react-query";
import { toRouteDetail, toRouteSegments } from "@/api/adapters";
import { api, unwrap } from "@/api/client";
import { queryKeys } from "@/api/queryClient";

/** One route: its geometry, every attempt at it, and how those attempts have gone. */
/**
 * The routes this one could be merged with, most alike first.
 *
 * Only once the merge dialog opens: scoring reads every candidate's geometry, which is
 * not work to do for a page that may never ask.
 */
export function useRouteSimilar(id: number, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.routeSimilar(id),
    queryFn: async () =>
      unwrap(
        await api.GET("/api/routes/{route_id}/similar", {
          params: { path: { route_id: id } },
        }),
      ),
    enabled: enabled && Number.isInteger(id),
  });
}

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
