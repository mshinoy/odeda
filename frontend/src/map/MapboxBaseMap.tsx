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
import { probeOf, type MapProbe } from "@/map/probe";
import { useCameraDriver } from "@/map/useCameraDriver";
import {
  FIT_PADDING_PX,
  MAX_PITCH,
  PICKING_RADIUS_PX,
  type MapBounds,
  type MapCamera,
  type ProviderMapProps,
} from "@/map/types";

export function MapboxBaseMap({
  layers,
  initialBounds,
  fitBounds,
  onHover,
  onLeave,
  cursor,
  camera,
  capture = false,
  onMap,
  mapStyle,
  lightPreset = "day",
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
      maxPitch={MAX_PITCH}
      interactive={!camera}
      preserveDrawingBuffer={capture}
      {...(capture ? { fadeDuration: 0 } : {})}
      attributionControl={false}
      logoPosition="bottom-right"
      cursor={cursor}
      onMouseOut={onLeave}
    >
      <AttributionControl position="bottom-right" compact />
      <NavigationControl position="top-right" showCompass={false} />
      <DeckOverlay layers={layers} onHover={onHover} />
      <FitBounds bounds={fitBounds} />
      <CameraDriver camera={camera} bounds={initialBounds} exact={capture} />
      <ProbeReporter onMap={onMap} />
      <LightPreset preset={lightPreset} />
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

// Follows a flyover camera frame by frame, and settles back to the route when it ends.
// Same as the other provider's, but each library's `useMap` only works under its own <Map>.
function CameraDriver({
  camera,
  bounds,
  exact,
}: {
  camera?: MapCamera | null;
  bounds: MapBounds;
  exact: boolean;
}) {
  const { current: map } = useMap();
  useCameraDriver(map, camera, bounds, exact);
  return null;
}

// Sets the lighting of a Mapbox Standard style, and keeps its 3D buildings on: a new style
// loads with its own defaults, so both are set again each time one loads. Styles without
// those settings (and Standard Satellite, which has no 3D buildings) ignore them.
function LightPreset({ preset }: { preset: "day" | "night" }) {
  const { current: map } = useMap();

  useEffect(() => {
    const mapbox = map?.getMap();
    if (!mapbox) return;
    const apply = () => {
      try {
        mapbox.setConfigProperty("basemap", "lightPreset", preset);
        mapbox.setConfigProperty("basemap", "show3dObjects", true);
      } catch {
        // A style with no "basemap" import, such as a custom one: nothing to light.
      }
    };
    if (mapbox.isStyleLoaded()) apply();
    mapbox.on("style.load", apply);
    return () => {
      mapbox.off("style.load", apply);
    };
  }, [map, preset]);

  return null;
}

// Hands the caller a way to wait for the map to be idle. Same as the other provider's, but
// each library's `useMap` only works under its own <Map>.
function ProbeReporter({ onMap }: { onMap?: (probe: MapProbe | null) => void }) {
  const { current: map } = useMap();

  useEffect(() => {
    if (!map || !onMap) return;
    onMap(probeOf(map.getMap() as unknown as Parameters<typeof probeOf>[0]));
    return () => onMap(null);
  }, [map, onMap]);

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
  const overlay = useControl(
    () => new MapboxOverlay({ interleaved: false, pickingRadius: PICKING_RADIUS_PX }),
  );

  useEffect(() => {
    overlay.setProps({ layers, onHover });
  }, [overlay, layers, onHover]);

  return null;
}
