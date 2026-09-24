import { useQuery } from "@tanstack/react-query";
import { toGymSession } from "@/api/adapters";
import { api, unwrap } from "@/api/client";
import { queryKeys } from "@/api/queryClient";

/**
 * The exercises of a gym session, read back from the raw Garmin payload. Keyed apart
 * from the activity: editing a field does not change what was lifted. Skipped
 * (`enabled`) for an activity that has no exercise data.
 */
export function useExercises(id: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.exercises(id),
    queryFn: async () =>
      toGymSession(
        unwrap(
          await api.GET("/api/activities/{activity_id}/exercises", {
            params: { path: { activity_id: id } },
          }),
        ),
      ),
    enabled,
  });
}
