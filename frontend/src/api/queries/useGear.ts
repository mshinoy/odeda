import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toGearItems } from "@/api/adapters";
import { api, unwrap } from "@/api/client";
import { queryKeys } from "@/api/queryClient";

/** Every gear item, retired included: a select has to be able to show the one in use. */
export function useGear() {
  return useQuery({
    queryKey: queryKeys.gear,
    queryFn: async () => toGearItems(unwrap(await api.GET("/api/gear"))),
  });
}

/**
 * Replaces an activity's whole gear set. The dialog sends the set rather than one
 * item, because a select set back to "None" is a removal, which `gear_id` cannot say.
 */
export function useSetActivityGear(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (gearIds: readonly number[]) =>
      unwrap(
        await api.PUT("/api/activities/{activity_id}/gear", {
          params: { path: { activity_id: id } },
          body: { gear_ids: [...gearIds] },
        }),
      ),
    // The activity page shows the gear, the list carries `gear_ids`, and every item's
    // mileage moved.
    onSuccess: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: queryKeys.activity(id) }),
        client.invalidateQueries({ queryKey: queryKeys.activitiesAll }),
        client.invalidateQueries({ queryKey: queryKeys.gear }),
      ]),
  });
}
