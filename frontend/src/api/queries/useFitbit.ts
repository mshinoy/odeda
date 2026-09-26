// The Fitbit connection: status, the consent URL, finishing the flow, syncing, and the
// offline import. Everything here is a mutation except the status, which is read off
// disk rather than from Fitbit — the account's budget is 150 requests an hour and a
// Settings page that spent one per open would be a poor use of it.
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { api, unwrap } from "@/api/client";
import { queryKeys } from "@/api/queryClient";
import type { components } from "@/api/schema";

type Schemas = components["schemas"];

export type FitbitStatus = Schemas["FitbitStatus"];
export type FitbitSyncResult = Schemas["FitbitSyncResult"];
export type FitbitImportResult = Schemas["FitbitImportResult"];

export function useFitbitStatus() {
  return useQuery({
    queryKey: queryKeys.fitbitStatus,
    queryFn: async () => unwrap(await api.GET("/api/fitbit/status")),
  });
}

/**
 * Connecting, syncing or importing all change what the body charts have to draw, so
 * every one of them invalidates the body queries as well as the status.
 */
function refreshAfterWeighIns(client: QueryClient) {
  return Promise.all([
    client.invalidateQueries({ queryKey: queryKeys.fitbitStatus }),
    client.invalidateQueries({ queryKey: ["body"] }),
  ]);
}

/**
 * Fetched on demand rather than held in a query, like Garmin's sign-in URL: each call
 * mints a fresh PKCE verifier on the server, so caching one would mean reusing a
 * challenge that a later call has already replaced.
 */
export async function fetchFitbitAuthorizeUrl(): Promise<string> {
  return unwrap(await api.GET("/api/fitbit/authorize-url")).url;
}

/** Finish the flow from the address bar the browser landed on, or the code in it. */
export function useFitbitConnect() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (redirect: string) =>
      unwrap(await api.POST("/api/fitbit/connect", { body: { redirect } })),
    onSuccess: () => refreshAfterWeighIns(client),
  });
}

export function useFitbitDisconnect() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async () => unwrap(await api.POST("/api/fitbit/disconnect")),
    onSuccess: () => refreshAfterWeighIns(client),
  });
}

/**
 * Pull weigh-ins. Synchronous on the server: a three-year backfill is ~36 requests
 * paced a second apart, so the whole job is under a minute.
 */
export function useFitbitSync() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async () => unwrap(await api.POST("/api/fitbit/sync")),
    onSuccess: () => refreshAfterWeighIns(client),
  });
}

/** Load a Google Takeout export from a path on the server. No credential, no limit. */
export function useFitbitImport() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (path: string) =>
      unwrap(await api.POST("/api/fitbit/import", { body: { path } })),
    onSuccess: () => refreshAfterWeighIns(client),
  });
}
