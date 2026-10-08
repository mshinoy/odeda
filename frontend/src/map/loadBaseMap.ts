// The two basemap modules, loaded on demand: only the library in use is downloaded.
// Apart from BaseMap.tsx so a page can start the download before it renders a map.
import { mapProvider } from "@/map/basemap";

export const loadMapbox = () =>
  import("@/map/MapboxBaseMap").then((module) => ({ default: module.MapboxBaseMap }));
export const loadMaplibre = () =>
  import("@/map/MaplibreBaseMap").then((module) => ({ default: module.MaplibreBaseMap }));

/**
 * Starts downloading the map library in use, for a page that knows it will show a map
 * but is still waiting for the data to put on it. Safe to call more than once.
 */
export function preloadBaseMap(): void {
  void (mapProvider === "mapbox" ? loadMapbox() : loadMaplibre());
}
