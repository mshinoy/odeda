import { useQuery } from "@tanstack/react-query";
import { api, unwrap } from "@/api/client";
import type { components } from "@/api/schema";

export type ActivityWeather = components["schemas"]["ActivityWeather"];
export type WeatherReading = components["schemas"]["ActivityWeatherReading"];

/**
 * The weather an outdoor activity was done in. Looked up once, kept for good, so it never
 * goes stale: no refetch, and a null reading (indoor, or not looked up yet) is a valid answer.
 */
export function useActivityWeather(id: string) {
  return useQuery({
    queryKey: ["activity", id, "weather"] as const,
    staleTime: Infinity,
    queryFn: async () =>
      unwrap(
        await api.GET("/api/activities/{activity_id}/weather", {
          params: { path: { activity_id: id } },
        }),
      ),
  });
}
