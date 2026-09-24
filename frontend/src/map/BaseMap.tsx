// A basemap with deck.gl layers on top, drawn by Mapbox or MapLibre (see basemap.ts).
// Each provider lives in its own lazily loaded module, so only the library in use is
// downloaded; the style follows the app theme.
import { lazy, Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { basemapStyle, mapProvider } from "@/map/basemap";
import type { BaseMapProps } from "@/map/types";
import { useTheme } from "@/design/theme";

const MapboxBaseMap = lazy(() =>
  import("@/map/MapboxBaseMap").then((module) => ({ default: module.MapboxBaseMap })),
);
const MaplibreBaseMap = lazy(() =>
  import("@/map/MaplibreBaseMap").then((module) => ({ default: module.MaplibreBaseMap })),
);

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
