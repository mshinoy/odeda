// A way for code outside a map to wait until it has finished drawing, which is what a video
// export needs before it copies a frame: camera settled, tiles in.

/** What it took for the map to be ready, so a slow frame can be told apart: waiting for tiles
 * to arrive, or the map itself taking time to draw. */
export interface IdleInfo {
  /** Draws until one had every tile in: 1 means the tiles were already there. */
  renders: number;
  /** The very first draw already had every tile. */
  readyFirst: boolean;
  timedOut: boolean;
}

export interface MapProbe {
  /**
   * Resolves once the map has drawn its current view with every tile for it loaded (or after
   * `timeoutMs`, so one slow tile cannot hang it). This is not Mapbox's own "idle", which also
   * waits for every label to finish fading and costs about a third of a second a frame.
   */
  whenIdle(timeoutMs?: number): Promise<IdleInfo>;
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
      return new Promise<IdleInfo>((resolve) => {
        let renders = 0;
        let ready = false;
        const finish = (timedOut: boolean) => {
          clearTimeout(timer);
          map.off("render", check);
          resolve({ renders, readyFirst: ready, timedOut });
        };
        // Each render is the map drawing the camera it was just given; if its tiles are in,
        // that picture is the one wanted.
        const check = () => {
          renders += 1;
          if (map.isStyleLoaded() && map.areTilesLoaded()) {
            ready = renders === 1;
            finish(false);
          }
        };
        const timer = setTimeout(() => finish(true), timeoutMs);
        map.on("render", check);
        // A repaint makes sure there is a render to check, even if nothing moved.
        map.triggerRepaint();
      });
    },
  };
}
