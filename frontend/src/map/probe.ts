// A way for code outside a map to wait until it has finished drawing, which is what a video
// export needs before it copies a frame: camera settled, tiles in.

export interface MapProbe {
  /**
   * Resolves once the map has drawn its current view with every tile for it loaded (or after
   * `timeoutMs`, so one slow tile cannot hang it). This is not Mapbox's own "idle", which also
   * waits for every label to finish fading and costs about a third of a second a frame.
   */
  whenIdle(timeoutMs?: number): Promise<void>;
}

/** The part of a Mapbox or MapLibre map this needs. */
interface RenderSource {
  triggerRepaint(): void;
  areTilesLoaded(): boolean;
  isStyleLoaded(): boolean;
  on(type: "render", listener: () => void): unknown;
  off(type: "render", listener: () => void): unknown;
}

const DEFAULT_TIMEOUT_MS = 20_000;

export function probeOf(map: RenderSource): MapProbe {
  return {
    whenIdle(timeoutMs = DEFAULT_TIMEOUT_MS) {
      return new Promise<void>((resolve) => {
        const finish = () => {
          clearTimeout(timer);
          map.off("render", check);
          resolve();
        };
        // Each render is the map drawing the camera it was just given; if its tiles are in,
        // that picture is the one wanted.
        const check = () => {
          if (map.isStyleLoaded() && map.areTilesLoaded()) finish();
        };
        const timer = setTimeout(finish, timeoutMs);
        map.on("render", check);
        // A repaint makes sure there is a render to check, even if nothing moved.
        map.triggerRepaint();
      });
    },
  };
}
