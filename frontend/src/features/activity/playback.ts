// The sums behind route playback, kept out of the component so they can be tested.
// Playback time is the activity's own `elapsed_s`, so the map, the scrubber and the
// charts' crosshair all speak the same clock.

/** How much faster than real time playback runs. A 90-minute run takes ~54 s at 100×, ~3.6 min at 25×. */
export const PLAYBACK_SPEEDS = [25, 50, 100, 200] as const;
export type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number];

export const DEFAULT_SPEED: PlaybackSpeed = 100;

/** The last elapsed value, or 0 for an activity with no samples. */
export function trackDuration(elapsedS: readonly number[]): number {
  return elapsedS[elapsedS.length - 1] ?? 0;
}

/**
 * Where playback is after one animation frame. It stops at the end rather than looping:
 * a replay that restarts on its own is hard to read the last kilometre of.
 */
export function advance(
  currentS: number,
  frameMs: number,
  speed: PlaybackSpeed,
  durationS: number,
): number {
  return Math.min(currentS + (frameMs / 1000) * speed, durationS);
}

/** Pressing play at the end starts again; anywhere else it carries on. */
export function resumeFrom(currentS: number, durationS: number): number {
  return currentS >= durationS ? 0 : currentS;
}

/**
 * The stream index playback is on: the last sample recorded at or before `elapsedS`.
 * Binary search, because this runs on every animation frame over tens of thousands of
 * samples.
 */
export function indexAtElapsed(elapsed: readonly number[], seconds: number): number {
  if (elapsed.length === 0) return 0;

  let lo = 0;
  let hi = elapsed.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if ((elapsed[mid] ?? Infinity) <= seconds) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return lo;
}
