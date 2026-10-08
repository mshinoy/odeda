// A route on a static map: one image per activity card, drawn by Mapbox's Static Images
// API from the encoded track the list sends. A page of live maps would need a WebGL
// context per card, and browsers stop at about sixteen.
import type { Theme } from "@/design/tokens";
import { basemapStyle, mapEnv, providerFor, type MapEnv } from "@/map/basemap";

const STATIC_API = "https://api.mapbox.com/styles/v1";

/** Mapbox's Static Images API refuses an image bigger than this on either side. */
const MAX_SIDE_PX = 1280;

export interface StaticMapRequest {
  /** Google encoded polyline, precision 5, as the list's `previewPolyline`. */
  polyline: string;
  theme: Theme;
  /** The route's colour, `#rrggbb`, from the design tokens. */
  color: string;
  /** CSS pixels; the image is requested at twice this for sharp screens. */
  width: number;
  height: number;
}

/**
 * The image URL, or null without a Mapbox token: MapLibre's free styles have no static
 * image service, so the card draws the trace itself instead.
 *
 * Mapbox's logo and attribution are left off the image, where they would cover a
 * small card's route, and shown once under the list instead, as Mapbox's terms allow.
 */
export function staticMapUrl(request: StaticMapRequest, env: MapEnv = mapEnv): string | null {
  if (providerFor(env) !== "mapbox") return null;
  const style = basemapStyle("mapbox", request.theme, env).replace(/^mapbox:\/\/styles\//, "");
  const width = Math.min(Math.round(request.width), MAX_SIDE_PX);
  const height = Math.min(Math.round(request.height), MAX_SIDE_PX);
  const color = request.color.replace(/^#/, "");
  const path = `path-3+${color}-0.95(${encodeURIComponent(request.polyline)})`;
  const query = new URLSearchParams({
    padding: "20",
    logo: "false",
    attribution: "false",
    access_token: env.mapboxToken,
  });
  return `${STATIC_API}/${style}/static/${path}/auto/${width}x${height}@2x?${query.toString()}`;
}
