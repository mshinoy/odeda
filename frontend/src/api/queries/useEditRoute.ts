import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { api, unwrap } from "@/api/client";
import { queryKeys } from "@/api/queryClient";

/**
 * A merge folds other routes away and a split makes a new one, so no route's own
 * cached page or segment profile can be trusted afterwards; nor can the list, nor the
 * activity rows, which carry the route an activity is filed under.
 */
function refreshAfterRouteEdit(client: QueryClient) {
  return Promise.all([
    client.invalidateQueries({ queryKey: queryKeys.routes }),
    client.invalidateQueries({ queryKey: queryKeys.routeAll }),
    client.invalidateQueries({ queryKey: queryKeys.routeSegmentsAll }),
    client.invalidateQueries({ queryKey: queryKeys.activitiesAll }),
  ]);
}

/** Names a route. Naming it pins it: the clusterer stops second-guessing it. */
export function useRenameRoute(id: number) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) =>
      unwrap(
        await api.PATCH("/api/routes/{route_id}", {
          params: { path: { route_id: id } },
          body: { name },
        }),
      ),
    onSuccess: () => refreshAfterRouteEdit(client),
  });
}

/** Folds other routes into this one. They stop existing; their attempts move here. */
export function useMergeRoutes(id: number) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (routeIds: number[]) =>
      unwrap(
        await api.POST("/api/routes/{route_id}/merge", {
          params: { path: { route_id: id } },
          body: { route_ids: routeIds },
        }),
      ),
    onSuccess: () => refreshAfterRouteEdit(client),
  });
}

export interface RouteSplit {
  activityIds: string[];
  /** The new route's name; the backend names it "<old name> (split)" when empty. */
  name: string;
}

/** Pulls attempts out of this route into a new one. */
export function useSplitRoute(id: number) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ activityIds, name }: RouteSplit) =>
      unwrap(
        await api.POST("/api/routes/{route_id}/split", {
          params: { path: { route_id: id } },
          body: { activity_ids: activityIds, name: name.trim() || null },
        }),
      ),
    onSuccess: () => refreshAfterRouteEdit(client),
  });
}
