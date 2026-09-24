// Which basemap library and style the maps use. Pure config: the environment is read in
// `readMapEnv` only, so the choice can be tested with any environment.
import type { Theme } from "@/design/tokens";

export type MapProvider = "mapbox" | "maplibre";

/** The map settings from the environment, with unset values as "". */
export interface MapEnv {
  mapboxToken: string;
  styleLight: string;
  styleDark: string;
}

type MapEnvSource = Pick<
  ImportMetaEnv,
  "VITE_MAPBOX_TOKEN" | "VITE_MAP_STYLE_LIGHT" | "VITE_MAP_STYLE_DARK"
>;

export function readMapEnv(source: MapEnvSource = import.meta.env): MapEnv {
  return {
    mapboxToken: (source.VITE_MAPBOX_TOKEN ?? "").trim(),
    styleLight: (source.VITE_MAP_STYLE_LIGHT ?? "").trim(),
    styleDark: (source.VITE_MAP_STYLE_DARK ?? "").trim(),
  };
}

/** Mapbox when a token is configured, otherwise MapLibre with free styles. */
export function providerFor(env: MapEnv): MapProvider {
  return env.mapboxToken !== "" ? "mapbox" : "maplibre";
}

export const mapEnv: MapEnv = readMapEnv();
export const mapProvider: MapProvider = providerFor(mapEnv);

const MAPBOX_STYLES: Record<Theme, string> = {
  light: "mapbox://styles/mapbox/light-v11",
  dark: "mapbox://styles/mapbox/dark-v11",
};

// Free CARTO styles, used when the environment names no MapLibre style.
const CARTO_STYLES: Record<Theme, string> = {
  light: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
  dark: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
};

export function basemapStyle(provider: MapProvider, theme: Theme, env: MapEnv = mapEnv): string {
  if (provider === "mapbox") return MAPBOX_STYLES[theme];
  // `||`, not `??`: an empty value in .env means "not set" and falls back too.
  const configured = theme === "light" ? env.styleLight : env.styleDark;
  return configured || CARTO_STYLES[theme];
}
