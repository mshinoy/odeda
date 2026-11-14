// Stretches where the watch lost GPS (a tunnel, an underpass) and picked it up somewhere
// further on. The watch records nothing inside one: no position, no speed, no distance.
// A real stop is different: the fix is there and the speed is a recorded zero. This
// module finds the first kind so the replay can treat them differently.
import type { ActivityGap, ActivityTrack } from "@/api/adapters";
import type { Trip } from "@/map/layers/makeTripsLayer";

const METRES_PER_DEG_LAT = 110_574;
const METRES_PER_DEG_LON_AT_EQUATOR = 111_320;
/** The backend's gap and the track's gap are the same stretch if their lengths agree this closely. */
const MATCH_TOLERANCE_S = 2;

type LonLat = [number, number];

/** One stretch without GPS, in the activity's own `elapsed_s`. */
export interface Crossing {
  startS: number;
  endS: number;
  /**
   * The average speed through it. From the route ridden there before when one is known,
   * otherwise the straight line between the two fixes: a floor, never a ceiling.
   */
  speedMps: number;
  /** The road ridden through it on other days, first and last points being the two fixes. */
  road: LonLat[] | null;
}

function metres(a: LonLat, b: LonLat): number {
  const dx =
    (b[0] - a[0]) * METRES_PER_DEG_LON_AT_EQUATOR * Math.cos(((a[1] + b[1]) / 2) * (Math.PI / 180));
  const dy = (b[1] - a[1]) * METRES_PER_DEG_LAT;
  return Math.hypot(dx, dy);
}

/**
 * Every recording gap in the trip. `trip.path` must be the track's own coordinates, one
 * for one, so the track's `gapBefore` flags say which steps crossed a gap; when they do
 * not line up, nothing is returned rather than guessed.
 */
export function findCrossings(
  trip: Trip,
  track: ActivityTrack | null,
  gaps: readonly ActivityGap[],
): Crossing[] {
  const flags = track?.gapBefore;
  if (!flags || trip.path.length !== flags.length) return [];

  const crossings: Crossing[] = [];
  let nth = 0;
  for (let k = 1; k < trip.path.length; k++) {
    if (!flags[k]) continue;

    const from = trip.path[k - 1];
    const to = trip.path[k];
    const startS = trip.timestamps[k - 1];
    const endS = trip.timestamps[k];
    const gap = gaps[nth++];
    if (!from || !to || startS === undefined || endS === undefined || endS <= startS) continue;

    // The estimate belongs to this stretch only if the backend measured the same one.
    const estimate =
      gap?.estimate && Math.abs(gap.seconds - (endS - startS)) <= MATCH_TOLERANCE_S
        ? gap.estimate
        : null;
    crossings.push({
      startS,
      endS,
      speedMps: estimate ? estimate.avgSpeedMps : metres(from, to) / (endS - startS),
      road: estimate && estimate.path.length >= 2 ? estimate.path : null,
    });
  }
  return crossings;
}

/** The crossing the replay is inside at `seconds`, or null. */
export function crossingAt(crossings: readonly Crossing[], seconds: number): Crossing | null {
  return crossings.find((c) => seconds > c.startS && seconds < c.endS) ?? null;
}

/**
 * The trip with each crossing's road put in, so the dot, the trail and the camera follow
 * the road through a tunnel instead of cutting straight across it. The road's points are
 * timed by how far along it they are, which is an even pace: the average, and nothing
 * more is known. A crossing with no known road stays a straight line.
 */
export function followRoads(trip: Trip, crossings: readonly Crossing[]): Trip {
  const withRoad = crossings.filter((c) => c.road !== null);
  if (withRoad.length === 0) return trip;

  const byStart = new Map(withRoad.map((c) => [c.startS, c]));
  const path: LonLat[] = [];
  const timestamps: number[] = [];

  trip.path.forEach((point, k) => {
    const time = trip.timestamps[k] ?? 0;
    const previousTime = trip.timestamps[k - 1];
    const crossing = previousTime === undefined ? undefined : byStart.get(previousTime);
    if (crossing?.road && crossing.endS === time) {
      // Interior points only: the two ends are the fixes either side.
      const road = crossing.road;
      const along: number[] = [0];
      for (let i = 1; i < road.length; i++) {
        const a = road[i - 1];
        const b = road[i];
        along.push((along[i - 1] ?? 0) + (a && b ? metres(a, b) : 0));
      }
      const total = along[along.length - 1] ?? 0;
      if (total > 0) {
        for (let i = 1; i < road.length - 1; i++) {
          const vertex = road[i];
          if (!vertex) continue;
          path.push(vertex);
          timestamps.push(
            crossing.startS + ((along[i] ?? 0) / total) * (crossing.endS - crossing.startS),
          );
        }
      }
    }
    path.push(point);
    timestamps.push(time);
  });

  return { path, timestamps };
}
