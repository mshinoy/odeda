// The Mapbox basemap. Loaded lazily by BaseMap, so mapbox-gl is only downloaded when a
// Mapbox token is configured.
import { useEffect } from "react";
import type { LayersList, PickingInfo } from "@deck.gl/core";
import { MapboxOverlay } from "@deck.gl/mapbox";
import {
  AttributionControl,
  Map as MapboxMap,
  NavigationControl,
  useControl,
} from "react-map-gl/mapbox";
import "mapbox-gl/dist/mapbox-gl.css";
import { mapEnv } from "@/map/basemap";
import { FIT_PADDING_PX, type ProviderMapProps } from "@/map/types";

export function MapboxBaseMap({
  layers,
  initialBounds,
  onHover,
  onLeave,
  cursor,
  mapStyle,
}: ProviderMapProps) {
  return (
    <MapboxMap
      mapboxAccessToken={mapEnv.mapboxToken}
      mapStyle={mapStyle}
      initialViewState={{ bounds: initialBounds, fitBoundsOptions: { padding: FIT_PADDING_PX } }}
      style={{ width: "100%", height: "100%" }}
      projection="mercator"
      dragRotate={false}
      pitchWithRotate={false}
      touchPitch={false}
      scrollZoom
      attributionControl={false}
      logoPosition="bottom-right"
      cursor={cursor}
      onMouseOut={onLeave}
    >
      <AttributionControl position="bottom-right" compact />
      <NavigationControl position="top-right" showCompass={false} />
      <DeckOverlay layers={layers} onHover={onHover} />
    </MapboxMap>
  );
}

interface DeckOverlayProps {
  layers: LayersList;
  onHover?: (info: PickingInfo) => void;
}

// deck.gl draws on its own canvas above the map (interleaved: false), kept in step with
// the map's camera by MapboxOverlay. Same as the MapLibre module's, but each library's
// `useControl` only works under its own <Map>.
function DeckOverlay({ layers, onHover }: DeckOverlayProps) {
  const overlay = useControl(() => new MapboxOverlay({ interleaved: false }));

  useEffect(() => {
    overlay.setProps({ layers, onHover });
  }, [overlay, layers, onHover]);

  return null;
}
