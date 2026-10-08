// The training plan: the whole block, one week in detail, and the two corrections the
// owner can make to a match the matcher got wrong.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, unwrap } from "@/api/client";
import { queryKeys } from "@/api/queryClient";
import type { components } from "@/api/schema";

export type Plan = components["schemas"]["Plan"];
export type PlanWeek = components["schemas"]["PlanWeek"];
export type PlanWeekDetail = components["schemas"]["PlanWeekDetail"];
export type PlanSession = components["schemas"]["PlanSession"];
export type PlanUnplanned = components["schemas"]["PlanUnplanned"];
export type PlanDecision = components["schemas"]["PlanDecision"];
export type PlanVerdict = PlanSession["verdict"];
export type RacePanelData = components["schemas"]["RacePanel"];

export function usePlan() {
  return useQuery({
    queryKey: queryKeys.plan,
    queryFn: async () => unwrap(await api.GET("/api/plan")),
  });
}

/** One week, session by session. `start` is any day in it; null skips the request. */
export function usePlanWeek(start: string | null) {
  return useQuery({
    queryKey: queryKeys.planWeek(start ?? ""),
    queryFn: async () =>
      unwrap(await api.GET("/api/plan/week", { params: { query: { start: start ?? "" } } })),
    enabled: start !== null,
  });
}

/** Countdown, 26 weeks of running kilometres, and the targets the plan sets. */
export function useRace() {
  return useQuery({
    queryKey: queryKeys.race,
    queryFn: async () => unwrap(await api.GET("/api/race")),
  });
}

/** Subscribe, or replace the address with a new one after Google rotates it. */
export function useSetPlanSource() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ url, label }: { url: string; label?: string }) =>
      unwrap(await api.PUT("/api/plan/source", { body: { url, label: label ?? null } })),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.planAll }),
  });
}

/** Unsubscribe. The sessions are withdrawn, not deleted: a judged week stays judged. */
export function useClearPlanSource() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async () => unwrap(await api.DELETE("/api/plan/source")),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.planAll }),
  });
}

export function useSyncPlan() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async () => unwrap(await api.POST("/api/plan/sync", { body: undefined })),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.planAll }),
  });
}

interface LinkArgs {
  sessionId: number;
  /** The activity that really fulfilled the session, or null with `ignore`. */
  activityId?: string | null;
  ignore?: boolean;
}

/**
 * Link a session to an activity, or ignore it.
 *
 * Both invalidate the whole plan prefix rather than the week they touched: one activity
 * fulfils at most one session, so claiming it here releases it somewhere else, and the
 * weekly numbers either side of that move with it.
 */
export function useSetPlanLink() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ sessionId, activityId = null, ignore = false }: LinkArgs) =>
      unwrap(
        await api.PUT("/api/plan/sessions/{session_id}/link", {
          params: { path: { session_id: sessionId } },
          body: { activity_id: activityId, ignore },
        }),
      ),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.planAll }),
  });
}

/** Drop the owner's decision and let the matcher have the session back. */
export function useClearPlanLink() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (sessionId: number) =>
      unwrap(
        await api.DELETE("/api/plan/sessions/{session_id}/link", {
          params: { path: { session_id: sessionId } },
        }),
      ),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.planAll }),
  });
}
