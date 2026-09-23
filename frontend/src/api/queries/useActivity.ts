import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { toActivity, type Activity } from "@/api/adapters";
import { api, unwrap } from "@/api/client";
import { queryKeys } from "@/api/queryClient";
import { useStreams } from "@/api/queries/useStreams";

/** The activity's metadata, splits, zones, gear and overrides; no samples. */
export function useActivityDetail(id: string) {
  return useQuery({
    queryKey: queryKeys.activity(id),
    queryFn: async () =>
      unwrap(
        await api.GET("/api/activities/{activity_id}", {
          params: { path: { activity_id: id } },
        }),
      ),
  });
}

export interface ActivityQuery {
  activity: Activity | undefined;
  isPending: boolean;
  error: Error | null;
}

/**
 * The full normalized activity (metadata + streams + track). The two requests run in
 * parallel and are cached separately: an edit refetches the detail, never the samples.
 */
export function useActivity(id: string): ActivityQuery {
  const detail = useActivityDetail(id);
  const streams = useStreams(id);

  const activity = useMemo(
    () =>
      detail.data && streams.data
        ? toActivity(detail.data, streams.data.streams, streams.data.track)
        : undefined,
    [detail.data, streams.data],
  );

  return {
    activity,
    isPending: detail.isPending || streams.isPending,
    error: detail.error ?? streams.error,
  };
}
