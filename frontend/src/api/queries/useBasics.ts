import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, unwrap } from "@/api/client";
import { queryKeys } from "@/api/queryClient";
import type { components } from "@/api/schema";

type Schemas = components["schemas"];

export type Basics = Schemas["Basics"];
export type BasicsSaved = Schemas["BasicsSaved"];
export type BasicsInput = Schemas["BasicsRequest"];
export type SetupStatus = Schemas["SetupStatus"];

/** Time zone and heart-rate limits in force, with the defaults `.env` gave. */
export function useBasics() {
  return useQuery({
    queryKey: queryKeys.basics,
    queryFn: async () => unwrap(await api.GET("/api/basics")),
  });
}

/**
 * Save them. Heart rate changes every stored training-load number and the time zone
 * decides what "today" is, so on success **everything** is refetched rather than a list
 * of keys that would go stale the next time a page starts using one of them.
 */
export function useSaveBasics() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (body: BasicsInput) => unwrap(await api.PUT("/api/basics", { body })),
    onSuccess: () => client.invalidateQueries(),
  });
}

/** Choose or change the password. Wrong current password is a 403 with a message. */
export function useChangePassword() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (body: { current: string; new: string }) =>
      unwrap(await api.POST("/api/auth/password", { body })),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.setup }),
  });
}

/** What a new install still needs: data, a Garmin connection, the basics, a password. */
export function useSetup() {
  return useQuery({
    queryKey: queryKeys.setup,
    queryFn: async () => unwrap(await api.GET("/api/setup")),
  });
}
