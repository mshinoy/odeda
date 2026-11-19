import { describe, expect, it } from "vitest";
import { proxiedUrl } from "@/map/mapboxProxy";

describe("proxiedUrl", () => {
  it("changes nothing without a proxy", () => {
    const url = "https://api.mapbox.com/styles/v1/mapbox/standard?access_token=pk.real";
    expect(proxiedUrl(url, "")).toBe(url);
  });

  it("sends the Mapbox API through the proxy and drops the token", () => {
    expect(
      proxiedUrl(
        "https://api.mapbox.com/styles/v1/mapbox/standard?access_token=pk.x&sku=1",
        "/mapbox",
      ),
    ).toBe("/mapbox/api/styles/v1/mapbox/standard?sku=1");
  });

  it("drops a query that held only the token", () => {
    expect(
      proxiedUrl("https://api.mapbox.com/fonts/v1/mapbox/a/0-255.pbf?access_token=pk.x", "/mapbox"),
    ).toBe("/mapbox/api/fonts/v1/mapbox/a/0-255.pbf");
  });

  it("keeps a path that has no query", () => {
    expect(
      proxiedUrl("https://api.mapbox.com/v4/mapbox.mapbox-streets-v8/1/2/3.vector.pbf", "/mapbox"),
    ).toBe("/mapbox/api/v4/mapbox.mapbox-streets-v8/1/2/3.vector.pbf");
  });

  it("sends the tile hosts through the proxy too", () => {
    expect(
      proxiedUrl("https://a.tiles.mapbox.com/v4/x/1/2/3.png?access_token=pk.x", "/mapbox"),
    ).toBe("/mapbox/tiles/v4/x/1/2/3.png");
  });

  it("sends telemetry to the proxy's sink", () => {
    expect(proxiedUrl("https://events.mapbox.com/events/v2?access_token=pk.x", "/mapbox")).toBe(
      "/mapbox/events",
    );
  });

  it("uses this site's origin when given one, so workers can resolve it", () => {
    expect(
      proxiedUrl(
        "https://api.mapbox.com/v4/a/1/2/3.vector.pbf?access_token=pk.x",
        "/mapbox",
        "https://odeda.run",
      ),
    ).toBe("https://odeda.run/mapbox/api/v4/a/1/2/3.vector.pbf");
  });

  it("leaves other addresses alone", () => {
    expect(proxiedUrl("https://example.com/a?access_token=1", "/mapbox")).toBe(
      "https://example.com/a?access_token=1",
    );
  });
});
