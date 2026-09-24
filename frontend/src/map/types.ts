import type { LayersList, PickingInfo } from "@deck.gl/core";

/** [[minLon, minLat], [maxLon, maxLat]] */
export type MapBounds = [[number, number], [number, number]];

/** What every basemap takes, whichever library draws it. */
export interface BaseMapProps {
  /** deck.gl layers drawn over the basemap. */
  layers: LayersList;
  /** Fitted with padding when the map loads; later changes do not move the map. */
  initialBounds: MapBounds;
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
