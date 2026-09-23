import { useQuery } from "@tanstack/react-query";
import {
  toActivityStreams,
  toActivityTrack,
  type ActivityStreams,
  type ActivityTrack,
} from "@/api/adapters";
import { api, unwrap } from "@/api/client";
import { queryKeys } from "@/api/queryClient";

export interface StreamsAndTrack {
  streams: ActivityStreams;
  track: ActivityTrack | null;
}

async function fetchStreams(id: string): Promise<StreamsAndTrack> {
  const raw = unwrap(
    await api.GET("/api/activities/{activity_id}/streams", {
      params: { path: { activity_id: id } },
    }),
  );
  const streams = toActivityStreams(raw);
  return { streams, track: toActivityTrack(streams) };
}

/**
 * The recorded samples, adapted once per fetch (derived pace and gradient included).
 * Samples never change after sync, so they are cached for the session.
 */
export function useStreams(id: string) {
  return useQuery({
    queryKey: queryKeys.streams(id),
    queryFn: () => fetchStreams(id),
    staleTime: Infinity,
  });
}
