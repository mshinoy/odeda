import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { toActivityListItem, type ActivityListItem } from "@/api/adapters";
import { api, unwrap } from "@/api/client";
import { queryKeys, type ActivityListParams } from "@/api/queryClient";

export interface ActivityPage {
  total: number;
  /** Every activity type present in the database, for the type filter. */
  types: string[];
  rows: ActivityListItem[];
}

async function fetchActivities(params: ActivityListParams): Promise<ActivityPage> {
  const page = unwrap(await api.GET("/api/activities", { params: { query: params } }));
  return { total: page.total, types: page.types, rows: page.rows.map(toActivityListItem) };
}

/** A page of activities. The previous page stays on screen while the next one loads. */
export function useActivities(params: ActivityListParams) {
  return useQuery({
    queryKey: queryKeys.activities(params),
    queryFn: () => fetchActivities(params),
    placeholderData: keepPreviousData,
  });
}
