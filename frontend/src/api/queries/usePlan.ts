// The training plan: the whole block, one week in detail, and the two corrections the
// owner can make to a match the matcher got wrong.
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, unwrap } from "@/api/client";
import { queryKeys } from "@/api/queryClient";
import type { components } from "@/api/schema";

export type Plan = components["schemas"]["Plan"];
export type PlanWeek = components["schemas"]["PlanWeek"];
export type PlanWeekDetail = components["schemas"]["PlanWeekDetail"];
export type PlanSession = components["schemas"]["PlanSession"];
export type PlanUnplanned = components["schemas"]["PlanUnplanned"];
export type PlanDecision = components["schemas"]["PlanDecision"];
export type PlanSteer = components["schemas"]["PlanSteer"];
export type SteerRisk = components["schemas"]["SteerRisk"];
export type PlanVerdict = PlanSession["verdict"];
export type RacePanelData = components["schemas"]["RacePanel"];
export type RaceForecast = components["schemas"]["RaceForecast"];
export type RacePacing = components["schemas"]["RacePacing"];

export function usePlan() {
  return useQuery({
    queryKey: queryKeys.plan,
    queryFn: async () => unwrap(await api.GET("/api/plan")),
  });
}

/**
 * Every judged session in the block, for the calendar.
 *
 * One request rather than one per week: the grid draws twenty-one weeks of days, and
 * the sessions carry their own `day`, so the view buckets them itself.
 */
export function usePlanSessions() {
  return useQuery({
    queryKey: queryKeys.planSessions,
    queryFn: async () => unwrap(await api.GET("/api/plan/sessions")),
  });
}

/** Where the owner stands against the plan, and what puts the race at risk. */
export function usePlanSteer() {
  return useQuery({
    queryKey: queryKeys.planSteer,
    queryFn: async () => unwrap(await api.GET("/api/plan/steer")),
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

/** Where the plan leaves your form on race morning, and the finish-time range. */
export function useRaceForecast() {
  return useQuery({
    queryKey: queryKeys.raceForecast,
    queryFn: async () => unwrap(await api.GET("/api/race/forecast")),
  });
}

/**
 * Per-kilometre splits for the goal race. With no target it is the likely finish; the
 * previous plan stays on screen while a new target loads, so the table does not flicker.
 */
export function useRacePacing(target: number | null, strategy: "even" | "negative") {
  return useQuery({
    queryKey: queryKeys.racePacing(target, strategy),
    queryFn: async () =>
      unwrap(
        await api.GET("/api/race/pacing", {
          params: { query: { ...(target === null ? {} : { target_s: target }), strategy } },
        }),
      ),
    placeholderData: keepPreviousData,
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

/**
 * Move the day the plan starts, or pass null to use the whole calendar.
 *
 * Nothing is deleted, so this is a reset rather than a purge: the sessions before the
 * line stay in the database and come back the moment it moves again.
 */
export function useSetPlanStart() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (startDay: string | null) =>
      unwrap(await api.PUT("/api/plan/start", { body: { start_day: startDay } })),
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

/** The owner's changes to the plan: move a session, change its distance, add one, remove one. */
export function useEditPlanSession() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({
      sessionId,
      day,
      distanceM,
    }: {
      sessionId: number;
      day?: string | null;
      distanceM?: number | null;
    }) =>
      unwrap(
        await api.PUT("/api/plan/sessions/{session_id}/edit", {
          params: { path: { session_id: sessionId } },
          body: { day: day ?? null, distance_m: distanceM ?? null },
        }),
      ),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.planAll }),
  });
}

/** Undo the owner's change to a calendar session. */
export function useClearPlanEdit() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (sessionId: number) =>
      unwrap(
        await api.DELETE("/api/plan/sessions/{session_id}/edit", {
          params: { path: { session_id: sessionId } },
        }),
      ),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.planAll }),
  });
}

export function useAddPlanSession() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (body: {
      day: string;
      sport: string;
      distance_m: number | null;
      title: string | null;
    }) => unwrap(await api.POST("/api/plan/sessions", { body })),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.planAll }),
  });
}

/** Remove a session the owner added. A calendar session cannot be removed here. */
export function useRemovePlanSession() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (sessionId: number) =>
      unwrap(
        await api.DELETE("/api/plan/sessions/{session_id}", {
          params: { path: { session_id: sessionId } },
        }),
      ),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.planAll }),
  });
}
