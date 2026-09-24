let cached: boolean | undefined;

/**
 * Whether this browser can create a WebGL context. Maps need it; without it (GPU
 * blocklisted, hardware acceleration off, some remote desktops) the map shows a
 * fallback instead of an error.
 */
export function supportsWebGL(): boolean {
  if (cached === undefined) {
    try {
      const canvas = document.createElement("canvas");
      cached = Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
    } catch {
      cached = false;
    }
  }
  return cached;
}
