// Route playback: the one decorative animation the design allows. A TripsLayer draws a
// fading trail behind the current position, with the activity's own `elapsed_s` as the
// clock, so the map, the scrubber and the charts' crosshair agree on where "now" is.
import { TripsLayer } from "@deck.gl/geo-layers";
import type { Activity, ActivityTrack } from "@/api/adapters";
import { hexToRgba, kindColor } from "@/design/scales";
import type { ColorTokens } from "@/design/tokens";
import type { ActivityKind } from "@/lib/activityKind";

export const TRIPS_LAYER_ID = "activity-trip";

const TRIP_WIDTH_PX = 5;
/** Seconds of activity time the trail stays visible; long enough to show direction. */
export const TRAIL_LENGTH_S = 180;

/** A TripsLayer datum: the whole track, with a timestamp per coordinate. */
export interface Trip {
  path: [number, number][];
  /** `elapsed_s` of the sample each coordinate came from; ascending. */
  timestamps: number[];
}

/**
 * The track paired with its times. Coordinates come from samples with a fix, so the
 * timestamps are those samples' `elapsed_s`, not a per-coordinate count.
 */
export function toTrip(track: ActivityTrack, elapsedS: readonly number[]): Trip {
  const path: [number, number][] = [];
  const timestamps: number[] = [];

  track.sampleIndex.forEach((streamIndex, k) => {
    const position = track.line.coordinates[k];
    const lon = position?.[0];
    const lat = position?.[1];
    const time = elapsedS[streamIndex];
    if (lon === undefined || lat === undefined || time === undefined) return;
    path.push([lon, lat]);
    timestamps.push(time);
  });

  return { path, timestamps };
}

interface TripsLayerOptions {
  /**
   * The trip, as deck.gl's data. An array of one, because deck.gl decides whether to
   * re-upload the path by comparing `data` by identity: built fresh here it would
   * re-send every coordinate on every frame of the replay.
   */
  trips: readonly Trip[];
  /** Where playback is, in the activity's `elapsed_s`. */
  currentTime: number;
  kind: ActivityKind;
  tokens: ColorTokens;
}

/** The trail at `currentTime`; null for a track too short to draw a trail along. */
export function makeTripsLayer({
  trips,
  currentTime,
  kind,
  tokens,
}: TripsLayerOptions): TripsLayer<Trip> | null {
  if ((trips[0]?.path.length ?? 0) < 2) return null;

  return new TripsLayer<Trip>({
    id: TRIPS_LAYER_ID,
    data: trips,
    getPath: (item) => item.path,
    getTimestamps: (item) => item.timestamps,
    getColor: hexToRgba(kindColor(tokens, kind)),
    widthUnits: "pixels",
    getWidth: TRIP_WIDTH_PX,
    capRounded: true,
    jointRounded: true,
    trailLength: TRAIL_LENGTH_S,
    currentTime,
    pickable: false,
  });
}

/**
 * Where the trip is at `seconds`, interpolated between samples the way the trail's own
 * head is, so a dot drawn here sits on the head instead of trailing at the last sample.
 * Null for a trip with no path; before the start and after the end it holds the end.
 */
export function tripPositionAt(trip: Trip, seconds: number): [number, number] | null {
  const { path, timestamps } = trip;
  const last = path.length - 1;
  if (last < 0) return null;
  if (last === 0 || seconds <= (timestamps[0] ?? 0)) return path[0] ?? null;
  if (seconds >= (timestamps[last] ?? 0)) return path[last] ?? null;

  let lo = 0;
  let hi = last;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if ((timestamps[mid] ?? Infinity) <= seconds) lo = mid;
    else hi = mid - 1;
  }
  const from = path[lo];
  const to = path[lo + 1];
  if (!from || !to) return from ?? null;
  const t0 = timestamps[lo] ?? 0;
  const t1 = timestamps[lo + 1] ?? t0;
  const fraction = t1 > t0 ? (seconds - t0) / (t1 - t0) : 0;
  return [from[0] + (to[0] - from[0]) * fraction, from[1] + (to[1] - from[1]) * fraction];
}

/** An activity's trip as deck.gl data: one item, or none when it has no track. */
export function activityTrips(activity: Activity): Trip[] {
  if (!activity.track) return [];
  return [toTrip(activity.track, activity.streams.elapsedS)];
}
