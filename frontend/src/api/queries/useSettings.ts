import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, unwrap } from "@/api/client";
import { queryKeys } from "@/api/queryClient";
import type { components } from "@/api/schema";

type Schemas = components["schemas"];

export type SyncEstimate = Schemas["SyncEstimate"];
export type OverridesSummary = Schemas["OverridesSummary"];
export type AppConfig = Schemas["AppConfig"];

/**
 * How big a full backfill would be. It counts activities missing streams and days
 * of history, so it moves only when a sync does — the default stale time is right.
 */
export function useSyncEstimate() {
  return useQuery({
    queryKey: queryKeys.syncEstimate,
    queryFn: async () => unwrap(await api.GET("/api/sync/estimate")),
  });
}

/** Every edit the user has made, counted by field. */
export function useOverridesSummary() {
  return useQuery({
    queryKey: queryKeys.overrides,
    queryFn: async () => unwrap(await api.GET("/api/overrides")),
  });
}

/** Version, race and athlete settings. Fixed for the life of the process. */
export function useConfig() {
  return useQuery({
    queryKey: queryKeys.config,
    queryFn: async () => unwrap(await api.GET("/api/config")),
    staleTime: Infinity,
  });
}

/** Asks a running sync to stop at its next checkpoint; it does not kill it. */
export function useStopSync() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async () => unwrap(await api.POST("/api/sync/stop")),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.syncStatus }),
  });
}
