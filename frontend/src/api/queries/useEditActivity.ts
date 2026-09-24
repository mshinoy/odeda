import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toEditableFields } from "@/api/adapters";
import { api, unwrap } from "@/api/client";
import { queryKeys } from "@/api/queryClient";
import type { paths } from "@/api/schema";

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
 * Saves edits to one activity. Afterwards every query that can show an edited value is
 * refetched: the activity, the list, Status (name, type, and excluded activities leave
 * the totals), the load curve and the heatmap. Streams are recorded samples and stay.
 */
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
    onSuccess: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: queryKeys.activity(id) }),
        client.invalidateQueries({ queryKey: queryKeys.activitiesAll }),
        client.invalidateQueries({ queryKey: queryKeys.summary }),
        client.invalidateQueries({ queryKey: queryKeys.load }),
        client.invalidateQueries({ queryKey: queryKeys.heatmapAll }),
      ]),
  });
}
