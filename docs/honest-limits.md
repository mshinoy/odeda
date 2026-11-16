# Honest limits

Read this part before you rely on the app. The short list is in the [README](../README.md#honest-limits).

* **The Garmin client is unofficial.**
  [`python-garminconnect`](https://github.com/cyberjunky/python-garminconnect) logs in
  as you through the same SSO flow the website uses. It is not a supported API, it is
  arguably against Garmin's terms of service, and **it can break without notice** when
  Garmin changes something. If ingestion stops working, that is the most likely reason;
  upgrading the pin in `requirements.txt` is the first thing to try.
* **Garmin may refuse to log you in from a server.** See
  [Signing in to Garmin](connecting-garmin.md#signing-in-to-garmin); the browser sign-in is the reliable
  route from a datacenter address.
* **Rate limits are real and undocumented.** A first full backfill of a multi-year
  account issues thousands of requests. Do not run it repeatedly; it is resumable
  precisely so that you do not have to.
* **The basemap is fetched from a third party.** Application code is served from the
  container, but map style and tiles come from CARTO's free basemaps by default, or
  from Mapbox when `VITE_MAPBOX_TOKEN` is set. Point `VITE_MAP_STYLE_LIGHT` /
  `VITE_MAP_STYLE_DARK` at your own style to keep even that local. These are read at
  build time, so rebuild after changing them: `npm run build` locally, or
  `docker compose build` for the image, which takes them as build args from the root
  `.env`.
* **Single-tenant.** There is no multi-user support and none is planned. Run your own
  container.
* **`APP_PASSWORD` is one shared password, not an identity system.** It stops the
  port being wide open. It is not a substitute for not exposing the port.
* **`APP_PASSWORD` has no brute-force lockout.** A wrong guess costs the attacker
  one second and costs you one worker thread; there is no attempt counter and no
  ban. That is adequate behind localhost or a VPN and is *not* adequate on a public
  port. Use a long random password and put a reverse proxy in front if you expose it.
* **Garmin's login errors are passed through verbatim.** They distinguish a wrong
  password from an unapproved device, which is why; upstream puts the URL and status
  in them, not the request body, but that is upstream's behaviour, not something this
  code enforces.
* **Set `TZ`.** The container is UTC unless you say otherwise, and the race
  countdown, the current streak and the 28-day rolling volume are all computed for
  "today" in local time.
* **Re-clustering is synchronous.** `POST /api/routes/recluster` compares every GPS
  activity against every candidate route in the request thread — about thirteen
  seconds for five hundred tracks, and it grows faster than linearly.
* **It is young.** Ingestion has run against one real account: on 2026-09-23 it
  pulled 487 activities back to December 2022, with the activity, sleep and GPS-stream
  parsers checked against the real payloads. It has not been run for months on end,
  and long-running stability, concurrent browsers, ARM builds and databases past a few
  hundred megabytes are untested.
