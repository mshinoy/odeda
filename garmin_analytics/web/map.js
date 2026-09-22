/* Map helpers built on vendored Leaflet.
 *
 * Three things the dashboard needs that Leaflet does not ship:
 *
 *  1. A polyline coloured by a *metric* (pace, HR, elevation, gradient) rather than
 *     one flat colour. Done by splitting the track into short segments and giving
 *     each its own colour — drawn on the canvas renderer, because a thousand SVG
 *     paths is visibly slow to pan.
 *  2. A heatmap. leaflet.heat is a separate dependency; this is ~70 lines of canvas
 *     and avoids vendoring another library for one view.
 *  3. A marker that a chart can drive, so hovering the elevation profile moves a dot
 *     along the route and vice versa.
 *
 * Tiles are the one thing fetched at runtime; the URL comes from /api/config so a
 * self-hoster can point it at their own server.
 */

'use strict';

const GA_MAP = (() => {
  /* Perceptual-ish ramp, dark-theme friendly: cool = low, hot = high.
     Used for every metric so "redder is more" is learned once. */
  const RAMP = [
    [ 59, 130, 246],   // blue
    [ 16, 185, 129],   // green
    [250, 204,  21],   // yellow
    [249, 115,  22],   // orange
    [239,  68,  68],   // red
  ];

  function rampColour(t) {
    if (!Number.isFinite(t)) return 'rgb(120,120,130)';
    t = Math.max(0, Math.min(1, t));
    const scaled = t * (RAMP.length - 1);
    const i = Math.min(RAMP.length - 2, Math.floor(scaled));
    const f = scaled - i;
    const a = RAMP[i], b = RAMP[i + 1];
    return `rgb(${Math.round(a[0] + (b[0] - a[0]) * f)},` +
           `${Math.round(a[1] + (b[1] - a[1]) * f)},` +
           `${Math.round(a[2] + (b[2] - a[2]) * f)})`;
  }

  /* Robust normalisation: 5th-95th percentile rather than min-max, so one GPS
     spike or a single stop at a traffic light does not flatten the whole scale. */
  function percentileRange(values) {
    const clean = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
    if (!clean.length) return [0, 1];
    const at = (p) => clean[Math.min(clean.length - 1, Math.max(0, Math.round(p * (clean.length - 1))))];
    const lo = at(0.05), hi = at(0.95);
    return hi > lo ? [lo, hi] : [clean[0], clean[0] + 1];
  }

  function create(node, cfg = {}) {
    const map = L.map(node, {
      zoomControl: true,
      attributionControl: true,
      preferCanvas: true,
      scrollWheelZoom: true,
    });
    map.setView([25.2854, 51.5310], 12);
    if (cfg.tile_url) {
      L.tileLayer(cfg.tile_url, {
        attribution: cfg.attribution || '',
        maxZoom: 19,
        crossOrigin: true,
      }).addTo(map);
    }
    return map;
  }

  /** Draw `latlngs` coloured by `values`. Returns {layer, range, invert}. */
  function colouredTrack(map, latlngs, values, opts = {}) {
    const layer = L.layerGroup().addTo(map);
    if (latlngs.length < 2) return { layer, range: [0, 1] };

    const renderer = L.canvas({ padding: 0.3 });
    const [lo, hi] = opts.range || percentileRange(values);
    const invert = !!opts.invert;   // pace: lower is better, so flip the ramp
    const weight = opts.weight || 4;

    /* Cap the number of drawn segments: 2 000 sub-polylines is slow to pan and
       indistinguishable from 600 at any real zoom level. */
    const maxSegments = opts.maxSegments || 600;
    const stride = Math.max(1, Math.ceil((latlngs.length - 1) / maxSegments));

    for (let i = 0; i + stride < latlngs.length; i += stride) {
      const slice = latlngs.slice(i, i + stride + 1);
      const chunk = values.slice(i, i + stride + 1).filter(Number.isFinite);
      const mean = chunk.length ? chunk.reduce((s, v) => s + v, 0) / chunk.length : NaN;
      let t = (mean - lo) / (hi - lo);
      if (invert) t = 1 - t;
      L.polyline(slice, {
        color: rampColour(t),
        weight,
        opacity: 0.92,
        renderer,
        lineCap: 'round',
        interactive: false,
      }).addTo(layer);
    }
    return { layer, range: [lo, hi], invert };
  }

  /** A plain single-colour track, for comparison overlays. */
  function plainTrack(map, latlngs, colour, opts = {}) {
    return L.polyline(latlngs, {
      color: colour,
      weight: opts.weight || 3,
      opacity: opts.opacity === undefined ? 0.85 : opts.opacity,
      dashArray: opts.dash || null,
      interactive: false,
    }).addTo(map);
  }

  /* Canvas heatmap layer. Each point stamps a radial-gradient blob into an
     accumulation buffer; the buffer is then mapped through the colour ramp. That
     two-pass approach is what makes overlapping tracks glow instead of just
     drawing the same colour twice. */
  const HeatLayer = L.Layer.extend({
    initialize(points, options) {
      this._points = points || [];
      L.setOptions(this, Object.assign({ radius: 12, blur: 0.85, minOpacity: 0.25 }, options));
    },
    onAdd(map) {
      this._map = map;
      this._canvas = L.DomUtil.create('canvas', 'leaflet-heat-layer leaflet-layer');
      const size = map.getSize();
      this._canvas.width = size.x;
      this._canvas.height = size.y;
      L.DomUtil.addClass(this._canvas,
        'leaflet-zoom-' + (map.options.zoomAnimation && L.Browser.any3d ? 'animated' : 'hide'));
      map.getPanes().overlayPane.appendChild(this._canvas);
      map.on('moveend zoomend resize', this._redraw, this);
      this._redraw();
    },
    onRemove(map) {
      map.getPanes().overlayPane.removeChild(this._canvas);
      map.off('moveend zoomend resize', this._redraw, this);
    },
    setPoints(points) {
      this._points = points || [];
      this._redraw();
    },
    _redraw() {
      if (!this._map) return;
      const map = this._map;
      const size = map.getSize();
      const canvas = this._canvas;
      if (canvas.width !== size.x || canvas.height !== size.y) {
        canvas.width = size.x;
        canvas.height = size.y;
      }
      L.DomUtil.setPosition(canvas, map.containerPointToLayerPoint([0, 0]));
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (!this._points.length) return;

      const r = this.options.radius;
      const stamp = this._stamp(r);
      const maxCount = this.options.maxCount || 1;
      const bounds = map.getBounds().pad(0.2);

      ctx.globalCompositeOperation = 'lighter';
      for (const [lat, lon, n] of this._points) {
        if (!bounds.contains([lat, lon])) continue;
        const p = map.latLngToContainerPoint([lat, lon]);
        ctx.globalAlpha = Math.max(this.options.minOpacity,
          Math.min(1, Math.log1p(n) / Math.log1p(maxCount)));
        ctx.drawImage(stamp, p.x - r, p.y - r);
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      this._colourise(ctx, canvas);
    },
    _stamp(r) {
      if (this._stampCanvas) return this._stampCanvas;
      const c = document.createElement('canvas');
      c.width = c.height = r * 2;
      const g = c.getContext('2d');
      const grad = g.createRadialGradient(r, r, 0, r, r, r);
      grad.addColorStop(0, 'rgba(255,255,255,1)');
      grad.addColorStop(this.options.blur, 'rgba(255,255,255,0.35)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, r * 2, r * 2);
      this._stampCanvas = c;
      return c;
    },
    _colourise(ctx, canvas) {
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        const a = d[i + 3];
        if (!a) continue;
        const t = a / 255;
        const col = rampColour(t);
        const m = col.match(/\d+/g);
        d[i] = +m[0];
        d[i + 1] = +m[1];
        d[i + 2] = +m[2];
        d[i + 3] = Math.min(235, a + 40);
      }
      ctx.putImageData(img, 0, 0);
    },
  });

  function heat(map, points, maxCount) {
    const layer = new HeatLayer(points, { maxCount: maxCount || 1 });
    layer.addTo(map);
    return layer;
  }

  /** A small dot the charts can drive. */
  function cursorMarker(map) {
    const marker = L.circleMarker([0, 0], {
      radius: 6,
      color: '#ffffff',
      weight: 2,
      fillColor: '#ef4444',
      fillOpacity: 1,
      interactive: false,
    });
    let attached = false;
    return {
      show(latlng) {
        marker.setLatLng(latlng);
        if (!attached) { marker.addTo(map); attached = true; }
      },
      hide() {
        if (attached) { map.removeLayer(marker); attached = false; }
      },
      marker,
    };
  }

  function fit(map, latlngs) {
    if (!latlngs || !latlngs.length) return;
    map.fitBounds(L.latLngBounds(latlngs), { padding: [18, 18] });
  }

  /** Horizontal colour-ramp legend, so the polyline's colours mean something. */
  function legend(loLabel, hiLabel, title) {
    const stops = [];
    for (let i = 0; i <= 10; i++) stops.push(rampColour(i / 10));
    return {
      node: (() => {
        const bar = document.createElement('div');
        bar.className = 'map-legend';
        bar.innerHTML =
          `<span class="t">${title || ''}</span>` +
          `<span class="lo">${loLabel}</span>` +
          `<span class="ramp" style="background:linear-gradient(90deg,${stops.join(',')})"></span>` +
          `<span class="hi">${hiLabel}</span>`;
        return bar;
      })(),
    };
  }

  return { create, colouredTrack, plainTrack, heat, cursorMarker, fit, legend,
           rampColour, percentileRange };
})();
