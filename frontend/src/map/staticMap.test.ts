import { describe, expect, it } from "vitest";
import { readMapEnv } from "@/map/basemap";
import { staticMapUrl } from "@/map/staticMap";

const mapbox = readMapEnv({ VITE_MAPBOX_TOKEN: "pk.test" });
const request = {
  // Google's example track: "_p~iF~ps|U_ulLnnqC_mqNvxq`@".
  polyline: "_p~iF~ps|U_ulLnnqC_mqNvxq`@",
  theme: "light" as const,
  color: "#e8590c",
  width: 240,
  height: 180,
};

describe("staticMapUrl", () => {
  it("draws the route on the theme's Mapbox style, fitted, at double resolution", () => {
    const url = new URL(staticMapUrl(request, mapbox) ?? "");
    expect(url.origin).toBe("https://api.mapbox.com");
    expect(decodeURIComponent(url.pathname)).toBe(
      "/styles/v1/mapbox/light-v11/static/path-3+e8590c-0.95(_p~iF~ps|U_ulLnnqC_mqNvxq`@)/auto/240x180@2x",
    );
    expect(url.searchParams.get("access_token")).toBe("pk.test");
    expect(url.searchParams.get("logo")).toBe("false");
  });

  it("draws a route recorded in pieces as one overlay each, with nothing between them", () => {
    const url = new URL(staticMapUrl({ ...request, polyline: "abc;def" }, mapbox) ?? "");
    expect(decodeURIComponent(url.pathname)).toContain(
      "static/path-3+e8590c-0.95(abc),path-3+e8590c-0.95(def)/auto/",
    );
  });

  it("follows the theme", () => {
    expect(staticMapUrl({ ...request, theme: "dark" }, mapbox)).toContain("/mapbox/dark-v11/");
  });

  it("escapes the characters an encoded polyline can hold", () => {
    const url = staticMapUrl({ ...request, polyline: "a?b\\c`d" }, mapbox) ?? "";
    expect(url).toContain("path-3+e8590c-0.95(a%3Fb%5Cc%60d)");
  });

  it("stays inside the API's size limit", () => {
    expect(staticMapUrl({ ...request, width: 2000, height: 900 }, mapbox)).toContain(
      "/auto/1280x900@2x",
    );
  });

  it("has nothing to offer without a Mapbox token", () => {
    expect(staticMapUrl(request, readMapEnv({}))).toBeNull();
  });
});
