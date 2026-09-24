// The MapLibre basemap, used when no Mapbox token is configured. Loaded lazily by
// BaseMap, so maplibre-gl is only downloaded when it is the provider in use.
import { useEffect } from "react";
import type { LayersList, PickingInfo } from "@deck.gl/core";
import { MapboxOverlay } from "@deck.gl/mapbox";
import {
  AttributionControl,
  Map as MaplibreMap,
  NavigationControl,
  useControl,
} from "react-map-gl/maplibre";
import { setWorkerUrl } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import "maplibre-gl/dist/maplibre-gl.css";
import { FIT_PADDING_PX, type ProviderMapProps } from "@/map/types";

// MapLibre looks for its worker next to its own chunk (`import.meta.url`), which is not
// where a bundler puts it, so without this every map logs "Worker failed to load" and
// draws on a blank background. `?worker&url` makes Vite bundle the worker with the
// shared chunk it imports and hand back the emitted URL, in dev and in the build alike.
setWorkerUrl(workerUrl);

export function MaplibreBaseMap({
  layers,
  initialBounds,
  onHover,
  onLeave,
  cursor,
  mapStyle,
}: ProviderMapProps) {
  return (
    <MaplibreMap
      mapStyle={mapStyle}
      initialViewState={{ bounds: initialBounds, fitBoundsOptions: { padding: FIT_PADDING_PX } }}
      style={{ width: "100%", height: "100%" }}
      dragRotate={false}
      pitchWithRotate={false}
      touchPitch={false}
      scrollZoom
      attributionControl={false}
      cursor={cursor}
      onMouseOut={onLeave}
    >
      <AttributionControl position="bottom-right" compact />
      <NavigationControl position="top-right" showCompass={false} />
      <DeckOverlay layers={layers} onHover={onHover} />
    </MaplibreMap>
  );
}

interface DeckOverlayProps {
  layers: LayersList;
  onHover?: (info: PickingInfo) => void;
}

// deck.gl draws on its own canvas above the map (interleaved: false), kept in step with
// the map's camera by MapboxOverlay, which works with MapLibre too. Same as the Mapbox
// module's, but each library's `useControl` only works under its own <Map>.
function DeckOverlay({ layers, onHover }: DeckOverlayProps) {
  const overlay = useControl(() => new MapboxOverlay({ interleaved: false }));

  useEffect(() => {
    overlay.setProps({ layers, onHover });
  }, [overlay, layers, onHover]);

  return null;
}
