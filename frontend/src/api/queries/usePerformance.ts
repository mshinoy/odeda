// Everything behind the Trends performance block in one round trip: records, aerobic
// decoupling, efficiency factor and VO2max.
import { useQuery } from "@tanstack/react-query";
import { api, unwrap } from "@/api/client";
import { queryKeys } from "@/api/queryClient";
import type { components } from "@/api/schema";

export type Performance = components["schemas"]["Performance"];

export function usePerformance() {
  return useQuery({
    queryKey: queryKeys.performance,
    queryFn: async () => unwrap(await api.GET("/api/performance")),
  });
}
