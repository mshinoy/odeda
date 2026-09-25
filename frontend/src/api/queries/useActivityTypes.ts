import { useQuery } from "@tanstack/react-query";
import { api, unwrap } from "@/api/client";
import { queryKeys, type ActivityListParams } from "@/api/queryClient";

// `/api/activities` reports every type in the database whatever the query asks for, so
// the smallest page there is answers "what can be filtered on" without a new endpoint.
const TYPES_ONLY: ActivityListParams = { limit: 1 };

/** Every activity type present, most common first, for a type filter outside the list. */
export function useActivityTypes() {
  return useQuery({
    queryKey: queryKeys.activityTypes,
    queryFn: async () =>
      unwrap(await api.GET("/api/activities", { params: { query: TYPES_ONLY } })).types,
  });
}
