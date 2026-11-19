// Behind a proxy (`VITE_MAPBOX_PROXY`), every request the Mapbox library makes goes to this
// site instead, and the server adds the token. The token is then never in the page, and the
// server can limit how fast anyone may pull map data. See `deploy/demo/nginx.conf.template`.

const MAPBOX_API = /^https:\/\/api\.mapbox\.com\//;
const MAPBOX_TILES = /^https:\/\/[a-d]\.tiles\.mapbox\.com\//;
const MAPBOX_EVENTS = /^https:\/\/events\.mapbox\.com\//;

/**
 * Where a Mapbox request should really go. Anything that is not a Mapbox address is returned
 * unchanged. The access token the library put on the address is dropped: the proxy has its own.
 * Telemetry is sent to the proxy's `/events`, which swallows it.
 */
export function proxiedUrl(url: string, proxy: string, origin = ""): string {
  if (proxy === "") return url;
  // The Mapbox library fetches from background workers, which cannot resolve a relative
  // address, so the proxy is given with this site's origin.
  proxy = origin + proxy;
  if (MAPBOX_EVENTS.test(url)) return `${proxy}/events`;
  const prefix = MAPBOX_API.test(url)
    ? `${proxy}/api/`
    : MAPBOX_TILES.test(url)
      ? `${proxy}/tiles/`
      : null;
  if (prefix === null) return url;
  const rest = url.replace(MAPBOX_API, "").replace(MAPBOX_TILES, "");
  return prefix + withoutToken(rest);
}

/** The path and query with any `access_token` parameter removed. */
function withoutToken(pathAndQuery: string): string {
  const at = pathAndQuery.indexOf("?");
  if (at < 0) return pathAndQuery;
  const path = pathAndQuery.slice(0, at);
  const query = pathAndQuery.slice(at + 1);
  const kept = query.split("&").filter((pair) => !pair.startsWith("access_token="));
  return kept.length > 0 ? `${path}?${kept.join("&")}` : path;
}

/** `transformRequest` for the Mapbox library: the proxied address, nothing else changed. */
export function transformThroughProxy(proxy: string, origin: string = window.location.origin) {
  return (url: string): { url: string } => ({ url: proxiedUrl(url, proxy, origin) });
}
