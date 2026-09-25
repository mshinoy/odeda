import type { LayersList, PickingInfo } from "@deck.gl/core";

/** [[minLon, minLat], [maxLon, maxLat]] */
export type MapBounds = [[number, number], [number, number]];

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
}

/** The provider modules also get the resolved style URL. */
export interface ProviderMapProps extends BaseMapProps {
  mapStyle: string;
}

export const FIT_PADDING_PX = 32;
