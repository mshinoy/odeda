import { useQuery } from "@tanstack/react-query";
import { api, unwrap } from "@/api/client";
import { queryKeys } from "@/api/queryClient";
import type { components } from "@/api/schema";

export type ExerciseHistory = components["schemas"]["ExerciseHistory"];

/**
 * What each exercise of a gym session was the last time it was done, and the session
 * before it. Under the exercises' own key, so naming an exercise refetches it: a name is
 * what gives an exercise a history.
 */
export function useExerciseHistory(id: string) {
  return useQuery({
    queryKey: [...queryKeys.exercises(id), "history"] as const,
    queryFn: async () =>
      unwrap(
        await api.GET("/api/activities/{activity_id}/exercise-history", {
          params: { path: { activity_id: id } },
        }),
      ),
  });
}
