import type { LayersList, PickingInfo } from "@deck.gl/core";

/** [[minLon, minLat], [maxLon, maxLat]] */
export type MapBounds = [[number, number], [number, number]];

/** A camera a caller drives frame by frame, for a flyover. */
export interface MapCamera {
  longitude: number;
  latitude: number;
  zoom: number;
  pitch: number;
  /** Degrees clockwise from north. */
  bearing: number;
}

/** What every basemap takes, whichever library draws it. */
export interface BaseMapProps {
  /** deck.gl layers drawn over the basemap. */
  layers: LayersList;
  /** Fitted with padding when the map loads; later changes do not move the map. */
  initialBounds: MapBounds;
  /**
   * Refits the camera whenever it changes, for a view whose data moves under it (the
   * heatmap, when a filter sends it to another city). Leave unset for a fixed map:
   * an unasked-for camera move is worse than a view that stays where it was put.
   */
  fitBounds?: MapBounds | null;
  /** Called on every pointer move over the map, with what deck.gl picked (maybe nothing). */
  onHover?: (info: PickingInfo) => void;
  /** Called when the pointer leaves the map. */
  onLeave?: () => void;
  /** CSS cursor over the map; the library's default (grab) when unset. */
  cursor?: string;
  /**
   * Takes the camera over while set: the map jumps to it on every change and stops
   * answering the pointer. Back to null refits `initialBounds`, flat and facing north.
   */
  camera?: MapCamera | null;
  /** Satellite imagery under the layers, where the provider has it (Mapbox only). */
  satellite?: boolean;
}

/** The provider modules also get the resolved style URL. */
export interface ProviderMapProps extends BaseMapProps {
  mapStyle: string;
  /** Lighting for Mapbox Standard styles; MapLibre's styles have none. */
  lightPreset?: "day" | "night";
}

export const FIT_PADDING_PX = 32;

/** How far the map may tilt; both libraries stop at 60° unless told otherwise. */
export const MAX_PITCH = 80;

/**
 * How far from a layer deck.gl still counts a pointer as on it. A route is drawn a few
 * pixels wide, and asking someone to land on exactly those pixels to read a segment
 * makes the hover detail unusable.
 */
export const PICKING_RADIUS_PX = 5;
