import { QueryClient } from "@tanstack/react-query";
import { ApiError } from "@/api/client";
import type { paths } from "@/api/schema";

export type ActivityListParams = NonNullable<
  paths["/api/activities"]["get"]["parameters"]["query"]
>;
export type HeatmapParams = NonNullable<paths["/api/heatmap"]["get"]["parameters"]["query"]>;
export type AggregateParams = NonNullable<paths["/api/aggregate"]["get"]["parameters"]["query"]>;

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
  /** Also under `activities`; the ids are one page of the list, in its order. */
  activityPreviews: (ids: readonly string[]) => ["activities", "previews", ids] as const,
  activity: (id: string) => ["activity", id] as const,
  streams: (id: string) => ["streams", id] as const,
  /** Where the watch paused and resumed elsewhere, with a guess at the path in between. */
  gaps: (id: string) => ["gaps", id] as const,
  exercises: (id: string) => ["exercises", id] as const,
  fields: ["fields"] as const,
  gear: ["gear"] as const,
  routes: ["routes"] as const,
  /** Every route detail: a merge or a split changes more routes than the one it names. */
  routeAll: ["route"] as const,
  route: (id: number) => ["route", id] as const,
  /** Apart from the route: only a re-cluster recomputes a segment profile. */
  routeSegmentsAll: ["route-segments"] as const,
  /** Merge candidates, scored; only fetched when the merge dialog opens. */
  routeSimilar: (id: number) => ["route", id, "similar"] as const,
  routeSegments: (id: number) => ["route-segments", id] as const,
  heatmapAll: ["heatmap"] as const,
  heatmap: (params: HeatmapParams) => ["heatmap", params] as const,
  /** Keyed on the ids in the order asked for: the colours follow that order. */
  compare: (ids: readonly string[]) => ["compare", ids.join(",")] as const,
  summary: ["summary"] as const,
  load: ["load"] as const,
  performance: ["performance"] as const,
  /** Totals, periods, distributions, patterns, streaks and records in one payload. */
  aggregateAll: ["aggregate"] as const,
  aggregate: (params: AggregateParams) => ["aggregate", params] as const,
  /** The filter bar's options; they change only when a sync adds a type or gear. */
  aggregateFilters: ["aggregate", "filters"] as const,
  /** Health's three queries, keyed by the window the shared range control asks for. */
  trends: (days: number) => ["trends", days] as const,
  daily: (days: number) => ["daily", days] as const,
  readinessHistory: (days: number) => ["readiness-history", days] as const,
  /** Body composition, on the same window as the rest of Health. */
  body: (days: number) => ["body", days] as const,
  /** The whole plan under one prefix: a re-link or a calendar sync re-judges every
   *  week, so the grid, this week's strip and a week's detail all go together. */
  planAll: ["plan"] as const,
  plan: ["plan", "all"] as const,
  planWeek: (start: string) => ["plan", "week", start] as const,
  /** Every judged session at once, so the calendar is one request and not twenty-one. */
  planSessions: ["plan", "sessions"] as const,
  /** Under the plan prefix, so re-linking a session or syncing the calendar refreshes it. */
  raceForecast: ["plan", "forecast"] as const,
  /** The race panel's own payload: countdown, 26 weeks of km, and the plan's targets. */
  race: ["race"] as const,
  garminStatus: ["garmin-status"] as const,
  /** Read off disk, so opening Settings never depends on the network to render. */
  fitbitStatus: ["fitbit-status"] as const,
  syncStatus: ["sync-status"] as const,
  /** The scheduler that syncs without the button; polled by the shell. */
  autoSync: ["auto-sync"] as const,
  syncEstimate: ["sync-estimate"] as const,
  /** The count of the user's edits; an edit anywhere moves it. */
  overrides: ["overrides"] as const,
  config: ["config"] as const,
};
