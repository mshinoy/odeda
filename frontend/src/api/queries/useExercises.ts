import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { toGymSession, type GymSession } from "@/api/adapters";
import { api, unwrap } from "@/api/client";
import { queryKeys } from "@/api/queryClient";
import type { components } from "@/api/schema";

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

/** The relabel body: Garmin's own vocabulary, so the muscle map can read it. */
export type ExerciseRelabel = components["schemas"]["ExerciseRelabelRequest"];

/**
 * Both relabel endpoints answer with the whole session, so the cache is replaced with
 * the response rather than refetched: the body diagram redraws in the same frame the
 * select changes. The activity and the list then refetch, because the relabel counts
 * towards the activity's `override_count` and its "Edited" mark.
 */
function afterRelabel(client: QueryClient, id: string, session: GymSession) {
  client.setQueryData(queryKeys.exercises(id), session);
  return Promise.all([
    client.invalidateQueries({ queryKey: queryKeys.activity(id) }),
    client.invalidateQueries({ queryKey: queryKeys.activitiesAll }),
    // A relabel is an override, and Settings counts those separately.
    client.invalidateQueries({ queryKey: queryKeys.overrides }),
  ]);
}

/** Says what an exercise really was, when Garmin guessed wrong or not at all. */
export function useRelabelExercise(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ index, ...body }: ExerciseRelabel & { index: number }) =>
      toGymSession(
        unwrap(
          await api.PUT("/api/activities/{activity_id}/exercises/{index}", {
            params: { path: { activity_id: id, index } },
            body,
          }),
        ),
      ),
    onSuccess: (session) => afterRelabel(client, id, session),
  });
}

/** Drops a relabel, so Garmin's own guess shows through again. */
export function useRevertExercise(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (index: number) =>
      toGymSession(
        unwrap(
          await api.DELETE("/api/activities/{activity_id}/exercises/{index}", {
            params: { path: { activity_id: id, index } },
          }),
        ),
      ),
    onSuccess: (session) => afterRelabel(client, id, session),
  });
}
