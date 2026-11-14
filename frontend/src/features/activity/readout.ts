// The live numbers over the map while an activity replays: how far, how fast, how hard.
// Kept out of the component so the smoothing and the formatting can be tested.
import type { ActivityStreams } from "@/api/adapters";
import { crossingAt, type Crossing } from "@/features/activity/crossings";
import { indexAtElapsed } from "@/features/activity/playback";
import type { ActivityKind } from "@/lib/activityKind";
import {
  formatDistance,
  formatHeartRate,
  formatPace,
  formatSpeed,
  formatSwimPace,
  movingSpeed,
} from "@/lib/format";

/**
 * The numbers are averaged over this much of the screen's time, not the activity's. A
 * replay runs at 50× to 200×, so a fixed few seconds of riding goes by in a few hundredths
 * of a second and the digits would flicker; two seconds on screen changes about as fast
 * as they can be read, whatever the speed.
 */
const SCREEN_WINDOW_S = 2;
/** Even at the slowest replay, average over at least this much activity. */
const MIN_WINDOW_S = 4;

type ReadoutStreams = Pick<ActivityStreams, "elapsedS" | "distanceM" | "speedMps" | "hr">;

/** Running totals of a stream, so the mean over any window is two lookups, not a pass. */
interface Totals {
  sum: Float64Array;
  count: Uint32Array;
}

function totalsOf(values: readonly (number | null)[]): Totals {
  const sum = new Float64Array(values.length + 1);
  const count = new Uint32Array(values.length + 1);
  values.forEach((value, i) => {
    sum[i + 1] = (sum[i] ?? 0) + (value ?? 0);
    count[i + 1] = (count[i] ?? 0) + (value === null ? 0 : 1);
  });
  return { sum, count };
}

/** The streams prepared for reading by the second: totalled once, not on every frame. */
export interface ReadoutSeries {
  elapsedS: readonly number[];
  distanceM: readonly (number | null)[];
  /** Totals of the recorded speed. A recorded zero counts; no reading at all does not. */
  speed: Totals;
  hr: Totals;
  /** Stretches without GPS, where the watch recorded no speed at all. */
  crossings: readonly Crossing[];
}

export function readoutSeries(
  streams: ReadoutStreams,
  crossings: readonly Crossing[] = [],
): ReadoutSeries {
  return {
    crossings,
    elapsedS: streams.elapsedS,
    distanceM: streams.distanceM,
    speed: totalsOf(streams.speedMps),
    hr: totalsOf(streams.hr),
  };
}

export interface Readout {
  distanceM: number | null;
  /** Null while standing still. */
  speedMps: number | null;
  hr: number | null;
  /** True when the speed is the average through a stretch without GPS, not a reading. */
  estimated: boolean;
}

/** The first index whose time is at or after `seconds`, or after it when `strictly`. */
function firstFrom(times: readonly number[], seconds: number, strictly = false): number {
  let lo = 0;
  let hi = times.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const t = times[mid] ?? Infinity;
    if (strictly ? t <= seconds : t < seconds) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** The mean of a stream over [from, to] seconds, or null when nothing was read in it. */
function meanBetween(
  times: readonly number[],
  totals: Totals,
  from: number,
  to: number,
): number | null {
  const lo = firstFrom(times, from);
  const hi = firstFrom(times, to, true);
  const count = (totals.count[hi] ?? 0) - (totals.count[lo] ?? 0);
  return count === 0 ? null : ((totals.sum[hi] ?? 0) - (totals.sum[lo] ?? 0)) / count;
}

/**
 * The numbers at `seconds` of the replay. Speed and heart rate are averaged over two
 * seconds of screen time (`replaySpeed` times that of the activity), so they settle
 * instead of flickering; the distance is blended between samples so it climbs smoothly.
 */
export function readoutAt(series: ReadoutSeries, seconds: number, replaySpeed: number): Readout {
  const i = indexAtElapsed(series.elapsedS, seconds);
  const from = series.elapsedS[i] ?? 0;
  const to = series.elapsedS[i + 1];
  const fraction =
    to !== undefined && to > from ? Math.min(Math.max((seconds - from) / (to - from), 0), 1) : 0;
  const distance = series.distanceM[i];
  const nextDistance = series.distanceM[i + 1];
  const distanceM =
    distance == null
      ? null
      : nextDistance == null
        ? distance
        : distance + (nextDistance - distance) * fraction;

  const half = Math.max(SCREEN_WINDOW_S * replaySpeed, MIN_WINDOW_S) / 2;
  const meanSpeed = meanBetween(series.elapsedS, series.speed, seconds - half, seconds + half);

  // A tunnel records no speed, but the rider was not standing still: a real stop keeps
  // its GPS fix and its recorded zero, so it reads as a stop and this does not.
  const crossing = crossingAt(series.crossings, seconds);
  return {
    distanceM,
    speedMps: crossing ? crossing.speedMps : movingSpeed(meanSpeed),
    hr: meanBetween(series.elapsedS, series.hr, seconds - half, seconds + half),
    estimated: crossing !== null,
  };
}

/**
 * The heart-rate zone (1 to 5) by heart-rate reserve, the convention the backend's zones
 * and `zone2Ceiling` use: zone 2 tops out at 70 %. Null without the athlete's rest and max.
 */
export function heartRateZone(
  bpm: number | null,
  hrRest: number | null | undefined,
  hrMax: number | null | undefined,
): number | null {
  if (bpm === null || !hrRest || !hrMax || hrMax <= hrRest) return null;
  const reserve = (bpm - hrRest) / (hrMax - hrRest);
  if (reserve < 0.6) return 1;
  if (reserve < 0.7) return 2;
  if (reserve < 0.8) return 3;
  if (reserve < 0.9) return 4;
  return 5;
}

export interface ReadoutLabels {
  distance: string;
  /** Speed for a ride, pace for everything else. */
  speed: { label: string; value: string };
  heartRate: string;
}

/** The numbers as they read on screen, in the unit each sport is talked about in. */
export function readoutLabels(kind: ActivityKind, readout: Readout): ReadoutLabels {
  const label = kind === "ride" ? "Speed" : "Pace";
  const mps = readout.speedMps;

  let value = "Stopped";
  if (mps !== null && mps > 0) {
    if (kind === "ride") value = formatSpeed(mps, 0);
    else if (kind === "swim") value = formatSwimPace(mps);
    else value = formatPace(1000 / mps);
    // Through a tunnel it is an average, not a reading: say so.
    if (readout.estimated) value = `≈ ${value}`;
  }

  return {
    distance: formatDistance(readout.distanceM),
    speed: { label, value },
    heartRate: formatHeartRate(readout.hr),
  };
}
