// Queries behind the Status page: today's summary, the load curve, and the Garmin /
// sync strip. Server shapes are used as generated; they are already the numbers shown.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { api, unwrap } from "@/api/client";
import { queryKeys } from "@/api/queryClient";
import type { components } from "@/api/schema";

export type Summary = components["schemas"]["Summary"];
export type TrainingLoad = components["schemas"]["TrainingLoad"];
export type SyncStatus = components["schemas"]["SyncStatus"];
export type GarminStatus = components["schemas"]["GarminStatus"];
export type AutoSyncStatus = components["schemas"]["AutoSyncStatus"];

export function useSummary() {
  return useQuery({
    queryKey: queryKeys.summary,
    queryFn: async () => unwrap(await api.GET("/api/summary")),
  });
}

export function useTrainingLoad() {
  return useQuery({
    queryKey: queryKeys.load,
    queryFn: async () => unwrap(await api.GET("/api/load")),
  });
}

export function useGarminStatus() {
  return useQuery({
    queryKey: queryKeys.garminStatus,
    queryFn: async () => unwrap(await api.GET("/api/garmin/status")),
  });
}

const SYNC_POLL_MS = 2000;

/** Polled every 2 s while a sync runs; when it finishes, everything derived is refetched. */
export function useSyncStatus() {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: queryKeys.syncStatus,
    queryFn: async () => unwrap(await api.GET("/api/sync/status")),
    refetchInterval: (q) => (q.state.data?.state === "running" ? SYNC_POLL_MS : false),
  });

  const wasRunning = useRef(false);
  const running = query.data?.state === "running";
  useEffect(() => {
    if (wasRunning.current && !running) {
      // New activities and wellness days change every other view.
      void client.invalidateQueries();
    }
    wasRunning.current = running;
  }, [running, client]);

  return query;
}

const AUTO_SYNC_POLL_MS = 60_000;

/**
 * The automatic sync, polled once a minute (every 2 s while it runs).
 *
 * Mounted in the shell, so a page left open picks up what a run brought in: when the
 * last run's `finished_at` moves, everything is refetched — the same thing a manual sync
 * does when it finishes. A run is seconds long, so watching for it to *stop running*
 * would usually miss it between polls; the finish time cannot be missed.
 */
export function useAutoSync() {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: queryKeys.autoSync,
    queryFn: async () => unwrap(await api.GET("/api/sync/auto")),
    refetchInterval: (q) => (q.state.data?.running ? SYNC_POLL_MS : AUTO_SYNC_POLL_MS),
  });

  const lastFinished = useRef<string | null | undefined>(undefined);
  const finished = query.data?.finished_at;
  useEffect(() => {
    if (finished === undefined) return;
    if (lastFinished.current !== undefined && finished !== lastFinished.current) {
      void client.invalidateQueries();
    }
    lastFinished.current = finished;
  }, [finished, client]);

  return query;
}

export function useStartSync() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async () => unwrap(await api.POST("/api/sync/start", { body: {} })),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.syncStatus }),
  });
}

/** The latest of: the last finished run, and the last time any endpoint synced. */
export function lastSyncedAt(status: SyncStatus): string | null {
  const times = [status.finished_at, ...status.watermarks.map((w) => w.last_run_at)].filter(
    (at): at is string => typeof at === "string",
  );
  // ISO timestamps in one format sort chronologically as strings.
  return times.sort().at(-1) ?? null;
}
