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
  activity: (id: string) => ["activity", id] as const,
  streams: (id: string) => ["streams", id] as const,
  fields: ["fields"] as const,
  heatmapAll: ["heatmap"] as const,
  heatmap: (params: HeatmapParams) => ["heatmap", params] as const,
};
