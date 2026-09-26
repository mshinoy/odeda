import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { toGarminConnection } from "@/api/adapters";
import { api, unwrap } from "@/api/client";
import { queryKeys } from "@/api/queryClient";
import type { components } from "@/api/schema";

type Schemas = components["schemas"];

/** What `POST /api/garmin/login` answers: connected, or paused for a code. */
export type GarminLoginResult = Schemas["GarminConnected"] | Schemas["GarminMfaRequired"];

/** Read off disk, not against Garmin, so it is cheap and always current. */
export function useGarminStatus() {
  return useQuery({
    queryKey: queryKeys.garminStatus,
    queryFn: async () => toGarminConnection(unwrap(await api.GET("/api/garmin/status"))),
  });
}

/**
 * Connecting or disconnecting changes what a sync can do and what `/api/health`
 * reports, so both the status and the sync panel are refetched after either.
 */
function refreshAfterConnectionChange(client: QueryClient) {
  return Promise.all([
    client.invalidateQueries({ queryKey: queryKeys.garminStatus }),
    client.invalidateQueries({ queryKey: queryKeys.syncStatus }),
  ]);
}

export interface GarminCredentials {
  email: string;
  password: string;
}

/**
 * Step one. The password is sent once and kept nowhere — not in the store, not in a
 * query cache, and the caller clears the field the moment this resolves either way.
 */
export function useGarminLogin() {
  const client = useQueryClient();
  return useMutation<GarminLoginResult, Error, GarminCredentials>({
    mutationFn: async ({ email, password }) =>
      unwrap(await api.POST("/api/garmin/login", { body: { email, password } })),
    onSuccess: () => refreshAfterConnectionChange(client),
  });
}

export interface GarminMfaCode {
  challengeId: string;
  code: string;
}

/** Step two, when Garmin asks for one. The challenge is single-use and expires. */
export function useGarminMfa() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ challengeId, code }: GarminMfaCode) =>
      unwrap(
        await api.POST("/api/garmin/mfa", {
          body: { challenge_id: challengeId, code },
        }),
      ),
    onSuccess: () => refreshAfterConnectionChange(client),
  });
}

/**
 * The fallback (D44): Garmin's own page does the half only a browser can do, and the
 * ticket it leaves in the address bar exchanges for tokens over an ordinary call.
 */
export function useGarminTicket() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (ticket: string) =>
      unwrap(await api.POST("/api/garmin/ticket", { body: { ticket } })),
    onSuccess: () => refreshAfterConnectionChange(client),
  });
}

export function useGarminDisconnect() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async () => unwrap(await api.POST("/api/garmin/disconnect")),
    onSuccess: () => refreshAfterConnectionChange(client),
  });
}

/**
 * Fetched on demand rather than held in a query: the URL is a constant the server
 * builds, and it is wanted only at the moment the user chooses the browser route.
 */
export async function fetchSigninUrl(): Promise<string> {
  return unwrap(await api.GET("/api/garmin/signin-url")).url;
}
