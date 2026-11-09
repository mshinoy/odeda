// A dashed line, made of short pieces. deck.gl's dashed paths need an extension this app
// does not carry, and a route's worth of pieces is cheap, so the dashes are cut here.

type LonLat = [number, number];

/** Metres per degree of latitude; longitude is narrowed by the cosine of the latitude. */
const METRES_PER_DEGREE = 111_320;

function metres(a: LonLat, b: LonLat): number {
  const midLat = ((a[1] + b[1]) / 2) * (Math.PI / 180);
  const dx = (b[0] - a[0]) * METRES_PER_DEGREE * Math.cos(midLat);
  const dy = (b[1] - a[1]) * METRES_PER_DEGREE;
  return Math.hypot(dx, dy);
}

function lerp(a: LonLat, b: LonLat, t: number): LonLat {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/**
 * The dashes of a line: pieces `onM` metres long, with `offM` metres left empty between
 * them, running along the path and carrying over its corners. Each dash is a path of its
 * own, so a bend inside one is kept.
 */
export function dashPaths(path: readonly LonLat[], onM: number, offM: number): LonLat[][] {
  const dashes: LonLat[][] = [];
  let current: LonLat[] = [];
  let drawing = true;
  let left = onM;

  for (let i = 0; i + 1 < path.length; i++) {
    const a = path[i];
    const b = path[i + 1];
    if (a === undefined || b === undefined) continue;
    const length = metres(a, b);
    if (length === 0) continue;
    if (drawing && current.length === 0) current.push(a);

    let travelled = 0;
    while (length - travelled > left) {
      travelled += left;
      const point = lerp(a, b, travelled / length);
      if (drawing) {
        current.push(point);
        dashes.push(current);
        current = [];
      } else {
        current = [point];
      }
      drawing = !drawing;
      left = drawing ? onM : offM;
    }
    left -= length - travelled;
    if (drawing) current.push(b);
  }
  if (drawing && current.length >= 2) dashes.push(current);
  return dashes;
}
