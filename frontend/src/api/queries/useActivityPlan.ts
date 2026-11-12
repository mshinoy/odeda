import { useQuery } from "@tanstack/react-query";
import { api, unwrap } from "@/api/client";
import { queryKeys } from "@/api/queryClient";
import type { components } from "@/api/schema";

export type ActivityPlan = components["schemas"]["ActivityPlan"];

/**
 * What the plan asked of this activity, and what it asks next of the same kind. Under the
 * plan prefix, so re-linking a session or syncing the calendar refreshes it.
 */
export function useActivityPlan(id: string) {
  return useQuery({
    queryKey: [...queryKeys.planAll, "activity", id] as const,
    queryFn: async () =>
      unwrap(
        await api.GET("/api/activities/{activity_id}/plan", {
          params: { path: { activity_id: id } },
        }),
      ),
  });
}
