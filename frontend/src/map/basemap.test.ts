import { describe, expect, it } from "vitest";
import { basemapStyle, mapboxLightPreset, providerFor, readMapEnv } from "@/map/basemap";

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
  it("uses Mapbox Standard in both themes, lit differently rather than restyled", () => {
    const env = readMapEnv({ VITE_MAPBOX_TOKEN: "pk.test" });
    expect(basemapStyle("mapbox", "light", env)).toBe("mapbox://styles/mapbox/standard");
    expect(basemapStyle("mapbox", "dark", env)).toBe("mapbox://styles/mapbox/standard");
  });

  it("uses Mapbox's satellite imagery on request, in either theme", () => {
    const env = readMapEnv({ VITE_MAPBOX_TOKEN: "pk.test" });
    const satellite = "mapbox://styles/mapbox/standard-satellite";
    expect(basemapStyle("mapbox", "light", env, true)).toBe(satellite);
    expect(basemapStyle("mapbox", "dark", env, true)).toBe(satellite);
  });

  it("has no free satellite, so MapLibre keeps its own style", () => {
    expect(basemapStyle("maplibre", "light", readMapEnv({}), true)).toBe(POSITRON);
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

describe("mapboxLightPreset", () => {
  it("lights the dark theme as night and the light theme as day", () => {
    expect(mapboxLightPreset("light")).toBe("day");
    expect(mapboxLightPreset("dark")).toBe("night");
  });

  it("keeps satellite imagery in daylight whatever the theme", () => {
    expect(mapboxLightPreset("dark", true)).toBe("day");
    expect(mapboxLightPreset("light", true)).toBe("day");
  });
});
