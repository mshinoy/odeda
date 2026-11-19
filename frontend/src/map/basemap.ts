// Which basemap library and style the maps use. Pure config: the environment is read in
// `readMapEnv` only, so the choice can be tested with any environment.
import type { Theme } from "@/design/tokens";

export type MapProvider = "mapbox" | "maplibre";

/** The map settings from the environment, with unset values as "". */
export interface MapEnv {
  mapboxToken: string;
  /**
   * A path on this site (for example `/mapbox`) that forwards Mapbox requests and adds the
   * token on the server, so the token is never in the page. Set for a public demo; see
   * `deploy/demo`. Empty means the browser talks to Mapbox directly with `mapboxToken`.
   */
  mapboxProxy: string;
  styleLight: string;
  styleDark: string;
}

type MapEnvSource = Pick<
  ImportMetaEnv,
  "VITE_MAPBOX_TOKEN" | "VITE_MAPBOX_PROXY" | "VITE_MAP_STYLE_LIGHT" | "VITE_MAP_STYLE_DARK"
>;

export function readMapEnv(source: MapEnvSource = import.meta.env): MapEnv {
  return {
    mapboxToken: (source.VITE_MAPBOX_TOKEN ?? "").trim(),
    mapboxProxy: (source.VITE_MAPBOX_PROXY ?? "").trim().replace(/\/+$/, ""),
    styleLight: (source.VITE_MAP_STYLE_LIGHT ?? "").trim(),
    styleDark: (source.VITE_MAP_STYLE_DARK ?? "").trim(),
  };
}

/** Mapbox when a token or a proxy is configured, otherwise MapLibre with free styles. */
export function providerFor(env: MapEnv): MapProvider {
  return env.mapboxToken !== "" || env.mapboxProxy !== "" ? "mapbox" : "maplibre";
}

/**
 * The token handed to the Mapbox library. Behind a proxy it is a placeholder: the library
 * insists on one, and the proxy replaces it with the real one on the server.
 */
export function mapboxLibraryToken(env: MapEnv): string {
  return env.mapboxProxy !== "" ? "pk.proxied" : env.mapboxToken;
}

export const mapEnv: MapEnv = readMapEnv();
export const mapProvider: MapProvider = providerFor(mapEnv);

// Satellite imagery with Standard's labels, 3D buildings and landmarks: more to see from a flyover.
const MAPBOX_SATELLITE = "mapbox://styles/mapbox/standard-satellite";

// Mapbox Standard for the flat maps too: more to read than Light and Dark. The theme picks
// its lighting (see `mapboxLightPreset`), not a different style.
const MAPBOX_STANDARD = "mapbox://styles/mapbox/standard";

// The card thumbnails come from Mapbox's Static Images API, which draws the classic styles
// and (as far as I know) not Standard, so they keep Light and Dark.
const MAPBOX_STATIC_STYLES: Record<Theme, string> = {
  light: "mapbox://styles/mapbox/light-v11",
  dark: "mapbox://styles/mapbox/dark-v11",
};

/** The Mapbox style for a static map image. */
export function staticBasemapStyle(theme: Theme): string {
  return MAPBOX_STATIC_STYLES[theme];
}

export type MapboxLightPreset = "day" | "night";

/**
 * The lighting for a Mapbox Standard map: night for the dark theme, day otherwise. Imagery
 * keeps its daylight in either theme, so a satellite map is never dimmed to match.
 */
export function mapboxLightPreset(theme: Theme, satellite = false): MapboxLightPreset {
  return theme === "dark" && !satellite ? "night" : "day";
}

// Free CARTO styles, used when the environment names no MapLibre style.
const CARTO_STYLES: Record<Theme, string> = {
  light: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
  dark: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
};

/**
 * `satellite` asks for imagery; only Mapbox has it here, and MapLibre's free styles
 * ignore the request rather than fail it.
 */
export function basemapStyle(
  provider: MapProvider,
  theme: Theme,
  env: MapEnv = mapEnv,
  satellite = false,
): string {
  if (provider === "mapbox") return satellite ? MAPBOX_SATELLITE : MAPBOX_STANDARD;
  // `||`, not `??`: an empty value in .env means "not set" and falls back too.
  const configured = theme === "light" ? env.styleLight : env.styleDark;
  return configured || CARTO_STYLES[theme];
}
