import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { toEditableFields } from "@/api/adapters";
import { api, unwrap } from "@/api/client";
import { queryKeys } from "@/api/queryClient";
import type { components, paths } from "@/api/schema";

type Schemas = components["schemas"];

/** PATCH body: field name to new value; null reverts the field to Garmin's. */
export type ActivityEditPatch =
  paths["/api/activities/{activity_id}"]["patch"]["requestBody"]["content"]["application/json"];

/** The editable-field registry. It changes only with the code, so it is fetched once. */
export function useEditableFields() {
  return useQuery({
    queryKey: queryKeys.fields,
    queryFn: async () => toEditableFields(unwrap(await api.GET("/api/fields"))),
    staleTime: Infinity,
  });
}

/**
 * After any edit or revert: the activity's cached row and edits are replaced with the
 * response at once (so the dialog never shows the old value while it refetches), then
 * every query that can show an edited value is refetched: the activity, the list,
 * Status (name, type, and excluded activities leave the totals), the load curve and
 * the heatmap. Streams are recorded samples and stay.
 */
function refreshAfterEdit(
  client: QueryClient,
  id: string,
  row: Schemas["ActivityRow"] | null,
  overrides: Schemas["Override"][],
) {
  client.setQueryData<Schemas["ActivityDetail"]>(queryKeys.activity(id), (detail) =>
    detail && row ? { ...detail, activity: row, overrides } : detail,
  );
  return Promise.all([
    client.invalidateQueries({ queryKey: queryKeys.activity(id) }),
    client.invalidateQueries({ queryKey: queryKeys.activitiesAll }),
    client.invalidateQueries({ queryKey: queryKeys.summary }),
    client.invalidateQueries({ queryKey: queryKeys.load }),
    client.invalidateQueries({ queryKey: queryKeys.heatmapAll }),
  ]);
}

/** Saves edits to one activity. */
export function useEditActivity(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (patch: ActivityEditPatch) =>
      unwrap(
        await api.PATCH("/api/activities/{activity_id}", {
          params: { path: { activity_id: id } },
          body: patch,
        }),
      ),
    onSuccess: (result) => refreshAfterEdit(client, id, result.activity, result.overrides),
  });
}

/** Puts one field back to Garmin's value (or clears a user-only one). */
export function useRevertField(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (field: string) =>
      unwrap(
        await api.DELETE("/api/activities/{activity_id}/overrides/{field}", {
          params: { path: { activity_id: id, field } },
        }),
      ),
    onSuccess: (result) => refreshAfterEdit(client, id, result.activity, result.overrides),
  });
}

/** Puts every edited field back to Garmin's value. */
export function useRevertAll(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      unwrap(
        await api.DELETE("/api/activities/{activity_id}/overrides", {
          params: { path: { activity_id: id } },
        }),
      ),
    onSuccess: (result) => refreshAfterEdit(client, id, result.activity, []),
  });
}
