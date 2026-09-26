import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { toGearCollection } from "@/api/adapters";
import { api, unwrap } from "@/api/client";
import { queryKeys } from "@/api/queryClient";
import type { components } from "@/api/schema";

/**
 * Every gear item, retired included: a select has to be able to show the one in use.
 *
 * The same fetch as `useGearCollection` under the same key — two query functions on
 * one key would race, and whichever ran first would hand the other the wrong shape.
 * A select narrows it for the callers that only want the items.
 */
export function useGear() {
  return useQuery({
    queryKey: queryKeys.gear,
    queryFn: fetchGearCollection,
    select: (collection) => collection.gear,
  });
}

async function fetchGearCollection() {
  return toGearCollection(unwrap(await api.GET("/api/gear")));
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

type Schemas = components["schemas"];

/** The gear page's view: every item with its mileage, the default rules, the kinds. */
export function useGearCollection() {
  return useQuery({ queryKey: queryKeys.gear, queryFn: fetchGearCollection });
}

/**
 * Gear mileage is the sum of the activities carrying it, so anything that moves a
 * distance or an assignment moves a wear bar — and the activity list carries
 * `gear_ids` on every row.
 */
function refreshAfterGearChange(client: QueryClient) {
  return Promise.all([
    client.invalidateQueries({ queryKey: queryKeys.gear }),
    client.invalidateQueries({ queryKey: queryKeys.gearDetailAll }),
    client.invalidateQueries({ queryKey: queryKeys.activitiesAll }),
    // The Trends filter bar offers the gear it finds, and filters by it.
    client.invalidateQueries({ queryKey: queryKeys.aggregateAll }),
  ]);
}

export type GearWrite = Schemas["GearCreateRequest"];

export function useCreateGear() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (body: GearWrite) => unwrap(await api.POST("/api/gear", { body })),
    onSuccess: () => refreshAfterGearChange(client),
  });
}

export function useUpdateGear(id: number) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (body: Schemas["GearWriteRequest"]) =>
      unwrap(await api.PATCH("/api/gear/{gear_id}", { params: { path: { gear_id: id } }, body })),
    onSuccess: () => refreshAfterGearChange(client),
  });
}

/**
 * Deleting an item drops its assignments with it; retiring keeps the history and
 * only takes it out of the selects. The dialog says which is which.
 */
export function useDeleteGear(id: number) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      unwrap(await api.DELETE("/api/gear/{gear_id}", { params: { path: { gear_id: id } } })),
    onSuccess: () => refreshAfterGearChange(client),
  });
}

/** The item and the activities it has been worn for. */
export function useGearDetail(id: number) {
  return useQuery({
    queryKey: queryKeys.gearDetail(id),
    queryFn: async () =>
      unwrap(await api.GET("/api/gear/{gear_id}", { params: { path: { gear_id: id } } })),
  });
}

export type BulkAssign = Schemas["GearBulkAssignRequest"];

/**
 * Puts one item on every activity matching a filter — the row that makes importing
 * years of gear-less history bearable. Always previewed with `dry_run` first.
 */
export function useBulkAssignGear(id: number) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (body: BulkAssign) =>
      unwrap(
        await api.POST("/api/gear/{gear_id}/bulk-assign", {
          params: { path: { gear_id: id } },
          body,
        }),
      ),
    // A dry run changes nothing, so it must not throw away the caches.
    onSuccess: (result) => (result.dry_run ? undefined : refreshAfterGearChange(client)),
  });
}

export interface GearDefaultChoice {
  activityType: string;
  gearId: number;
}

/** The gear a newly-synced activity of this type will get. One per type and kind. */
export function useSetGearDefault() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ activityType, gearId }: GearDefaultChoice) =>
      unwrap(
        await api.POST("/api/gear/defaults", {
          body: { activity_type: activityType, gear_id: gearId },
        }),
      ),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.gear }),
  });
}

export function useClearGearDefault() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ activityType, gearId }: GearDefaultChoice) =>
      unwrap(
        await api.DELETE("/api/gear/defaults/{activity_type}/{gear_id}", {
          params: { path: { activity_type: activityType, gear_id: gearId } },
        }),
      ),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.gear }),
  });
}
