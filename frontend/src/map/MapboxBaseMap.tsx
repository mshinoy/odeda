// The Mapbox basemap. Loaded lazily by BaseMap, so mapbox-gl is only downloaded when a
// Mapbox token is configured.
import { useEffect, useRef } from "react";
import type { LayersList, PickingInfo } from "@deck.gl/core";
import { MapboxOverlay } from "@deck.gl/mapbox";
import {
  AttributionControl,
  Map as MapboxMap,
  NavigationControl,
  useControl,
  useMap,
} from "react-map-gl/mapbox";
import "mapbox-gl/dist/mapbox-gl.css";
import { mapEnv } from "@/map/basemap";
import { FIT_PADDING_PX, type MapBounds, type ProviderMapProps } from "@/map/types";

export function MapboxBaseMap({
  layers,
  initialBounds,
  fitBounds,
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
      <FitBounds bounds={fitBounds} />
    </MapboxMap>
  );
}

// Flies to a new box when the data under the map moves. The first fit is the map's own
// `initialViewState`, so this skips the box it mounted with. Same as the MapLibre
// module's, but each library's `useMap` only works under its own <Map>.
function FitBounds({ bounds }: { bounds?: MapBounds | null }) {
  const { current: map } = useMap();
  const mounted = useRef(false);

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    if (map && bounds) map.fitBounds(bounds, { padding: FIT_PADDING_PX });
  }, [map, bounds]);

  return null;
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
