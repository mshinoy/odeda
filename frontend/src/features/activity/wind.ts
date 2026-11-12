// Wind against the route: which way each stretch was heading, and so how much of the
// wind was in the runner's face. Pure functions over the streams and one weather reading.
import type { ActivityStreams } from "@/api/adapters";

const EARTH_RADIUS_M = 6_371_000;
/** Heading is read between points at least this far apart, so GPS jitter does not spin it. */
const HEADING_SPAN_M = 20;
/** Under this a stretch counts as side-on: a few km/h is not felt as a headwind. */
export const FELT_KMH = 3;

const POINTS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;

/** The eight-point compass name of a bearing in degrees, 0 = north. */
export function compass(degrees: number): string {
  const index = Math.round((((degrees % 360) + 360) % 360) / 45) % 8;
  return POINTS[index] ?? "N";
}

function bearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dl = ((lon2 - lon1) * Math.PI) / 180;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function metresBetween(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

/**
 * Per sample, the wind along the direction of travel: positive into a headwind, negative
 * with a tailwind, null where there is no fix or the runner was not going anywhere.
 * `fromDeg` is where the wind blows FROM, as the weather service reports it, so running
 * due north into a north wind is a full headwind.
 */
export function headwindKmh(
  streams: Pick<ActivityStreams, "lat" | "lon" | "length">,
  windKmh: number,
  fromDeg: number,
): (number | null)[] {
  const { lat, lon, length } = streams;
  const out: (number | null)[] = new Array<number | null>(length).fill(null);
  const fix = (i: number): [number, number] | null => {
    const a = lat[i];
    const b = lon[i];
    return a === null || a === undefined || b === null || b === undefined ? null : [a, b];
  };

  let behind = 0;
  let ahead = 0;
  for (let i = 0; i < length; i++) {
    const here = fix(i);
    if (here === null) continue;
    // Walk the two ends outwards until each is far enough from `i` along the fixes.
    behind = Math.min(behind, i);
    while (behind < i) {
      const p = fix(behind);
      if (p !== null && metresBetween(p[0], p[1], here[0], here[1]) <= HEADING_SPAN_M) break;
      behind++;
    }
    ahead = Math.max(ahead, i);
    while (ahead < length - 1) {
      const p = fix(ahead);
      if (p !== null && metresBetween(here[0], here[1], p[0], p[1]) >= HEADING_SPAN_M) break;
      ahead++;
    }
    const from = fix(behind);
    const to = fix(ahead);
    if (from === null || to === null) continue;
    if (metresBetween(from[0], from[1], to[0], to[1]) < HEADING_SPAN_M / 2) continue;
    const heading = bearing(from[0], from[1], to[0], to[1]);
    out[i] = windKmh * Math.cos(((fromDeg - heading) * Math.PI) / 180);
  }
  return out;
}

/** The streams with the headwind column filled in from one weather reading. */
export function withHeadwind(
  streams: ActivityStreams,
  windKmh: number | null | undefined,
  fromDeg: number | null | undefined,
): ActivityStreams {
  if (windKmh === null || windKmh === undefined || fromDeg === null || fromDeg === undefined) {
    return streams;
  }
  return { ...streams, headwindKmh: headwindKmh(streams, windKmh, fromDeg) };
}

export interface WindShare {
  /** Shares of the distance, each 0..1. They add to 1. */
  head: number;
  tail: number;
  side: number;
}

/** How the distance split into headwind, tailwind and side-on stretches. */
export function windShare(
  headwind: readonly (number | null)[],
  distanceM: readonly (number | null)[],
): WindShare | null {
  let head = 0;
  let tail = 0;
  let side = 0;
  let previous: number | null = null;
  for (let i = 0; i < headwind.length; i++) {
    const d = distanceM[i] ?? null;
    const w = headwind[i] ?? null;
    if (d !== null && previous !== null && w !== null && d > previous) {
      const step = d - previous;
      if (w >= FELT_KMH) head += step;
      else if (w <= -FELT_KMH) tail += step;
      else side += step;
    }
    if (d !== null) previous = d;
  }
  const total = head + tail + side;
  return total > 0 ? { head: head / total, tail: tail / total, side: side / total } : null;
}
