// A basemap with deck.gl layers on top, drawn by Mapbox or MapLibre (see basemap.ts).
// Each provider lives in its own lazily loaded module, so only the library in use is
// downloaded; the style follows the app theme.
import { lazy, Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { basemapStyle, mapProvider } from "@/map/basemap";
import type { BaseMapProps } from "@/map/types";
import { useTheme } from "@/design/theme";

const loadMapbox = () =>
  import("@/map/MapboxBaseMap").then((module) => ({ default: module.MapboxBaseMap }));
const loadMaplibre = () =>
  import("@/map/MaplibreBaseMap").then((module) => ({ default: module.MaplibreBaseMap }));
const MapboxBaseMap = lazy(loadMapbox);
const MaplibreBaseMap = lazy(loadMaplibre);

/**
 * Starts downloading the map library in use, for a page that knows it will show a map
 * but is still waiting for the data to put on it. Safe to call more than once.
 */
export function preloadBaseMap(): void {
  void (mapProvider === "mapbox" ? loadMapbox() : loadMaplibre());
}

export function BaseMap(props: BaseMapProps) {
  const theme = useTheme();
  const mapStyle = basemapStyle(mapProvider, theme);

  return (
    <Suspense fallback={<Skeleton className="h-full w-full rounded-none" />}>
      {mapProvider === "mapbox" ? (
        <MapboxBaseMap {...props} mapStyle={mapStyle} />
      ) : (
        <MaplibreBaseMap {...props} mapStyle={mapStyle} />
      )}
    </Suspense>
  );
}
