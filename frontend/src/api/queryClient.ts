import { QueryClient } from "@tanstack/react-query";
import { ApiError } from "@/api/client";
import type { paths } from "@/api/schema";

export type ActivityListParams = NonNullable<
  paths["/api/activities"]["get"]["parameters"]["query"]
>;
export type HeatmapParams = NonNullable<paths["/api/heatmap"]["get"]["parameters"]["query"]>;

function shouldRetry(failureCount: number, error: Error): boolean {
  // A 4xx will not fix itself on a second try.
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
  return failureCount < 1;
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      retry: shouldRetry,
      refetchOnWindowFocus: false,
    },
  },
});

/**
 * Every query key in one place, so invalidation after an edit is explicit.
 * Streams are keyed separately from the activity: editing an activity's fields
 * does not change its recorded samples.
 */
export const queryKeys = {
  activitiesAll: ["activities"] as const,
  activities: (params: ActivityListParams) => ["activities", params] as const,
  /** Under `activities` so a sync invalidates it too; a string, so no params key collides. */
  activityTypes: ["activities", "types"] as const,
  activity: (id: string) => ["activity", id] as const,
  streams: (id: string) => ["streams", id] as const,
  exercises: (id: string) => ["exercises", id] as const,
  fields: ["fields"] as const,
  gear: ["gear"] as const,
  routes: ["routes"] as const,
  /** Every route detail: a merge or a split changes more routes than the one it names. */
  routeAll: ["route"] as const,
  route: (id: number) => ["route", id] as const,
  /** Apart from the route: only a re-cluster recomputes a segment profile. */
  routeSegmentsAll: ["route-segments"] as const,
  routeSegments: (id: number) => ["route-segments", id] as const,
  heatmapAll: ["heatmap"] as const,
  heatmap: (params: HeatmapParams) => ["heatmap", params] as const,
  /** Keyed on the ids in the order asked for: the colours follow that order. */
  compare: (ids: readonly string[]) => ["compare", ids.join(",")] as const,
  summary: ["summary"] as const,
  load: ["load"] as const,
  performance: ["performance"] as const,
  /** Health's three queries, keyed by the window the shared range control asks for. */
  trends: (days: number) => ["trends", days] as const,
  daily: (days: number) => ["daily", days] as const,
  readinessHistory: (days: number) => ["readiness-history", days] as const,
  garminStatus: ["garmin-status"] as const,
  syncStatus: ["sync-status"] as const,
};
