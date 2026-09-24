import { describe, expect, it } from "vitest";
import { basemapStyle, providerFor, readMapEnv } from "@/map/basemap";

const POSITRON = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
const DARK_MATTER = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

describe("providerFor", () => {
  it("uses Mapbox only when a token is set", () => {
    expect(providerFor(readMapEnv({ VITE_MAPBOX_TOKEN: "pk.test" }))).toBe("mapbox");
    expect(providerFor(readMapEnv({ VITE_MAPBOX_TOKEN: "" }))).toBe("maplibre");
    expect(providerFor(readMapEnv({ VITE_MAPBOX_TOKEN: "  " }))).toBe("maplibre");
    expect(providerFor(readMapEnv({}))).toBe("maplibre");
  });
});

describe("basemapStyle", () => {
  it("uses Mapbox's light and dark styles", () => {
    const env = readMapEnv({ VITE_MAPBOX_TOKEN: "pk.test" });
    expect(basemapStyle("mapbox", "light", env)).toBe("mapbox://styles/mapbox/light-v11");
    expect(basemapStyle("mapbox", "dark", env)).toBe("mapbox://styles/mapbox/dark-v11");
  });

  it("uses the configured MapLibre styles", () => {
    const env = readMapEnv({
      VITE_MAP_STYLE_LIGHT: "https://tiles.example/light.json",
      VITE_MAP_STYLE_DARK: "https://tiles.example/dark.json",
    });
    expect(basemapStyle("maplibre", "light", env)).toBe("https://tiles.example/light.json");
    expect(basemapStyle("maplibre", "dark", env)).toBe("https://tiles.example/dark.json");
  });

  it("falls back to CARTO when a MapLibre style is unset or empty", () => {
    expect(basemapStyle("maplibre", "light", readMapEnv({}))).toBe(POSITRON);
    const empty = readMapEnv({ VITE_MAP_STYLE_LIGHT: "", VITE_MAP_STYLE_DARK: "" });
    expect(basemapStyle("maplibre", "light", empty)).toBe(POSITRON);
    expect(basemapStyle("maplibre", "dark", empty)).toBe(DARK_MATTER);
  });
});
