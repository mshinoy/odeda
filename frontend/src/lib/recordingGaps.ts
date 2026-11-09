// A recording gap is a pause where the watch resumed somewhere else. The line across it
// was never travelled, so it is not drawn. The same rule is in `api/preview.py`, which
// splits the routes the activity cards draw; keep the three numbers equal.

/** At least this long between two GPS samples... */
export const GAP_MIN_SECONDS = 60;
/** ...with the points at least this far apart... */
export const GAP_MIN_METRES = 250;
/** ...and the device's own recorded distance moving by less than this share of that line. */
export const GAP_RECORDED_SHARE = 0.5;

export interface GpsSample {
  elapsedS: number;
  /** The device's recorded distance, or null when there is none. */
  distanceM: number | null;
  lat: number;
  lon: number;
}

function metresBetween(a: GpsSample, b: GpsSample): number {
  const radius = 6371000;
  const p1 = (a.lat * Math.PI) / 180;
  const p2 = (b.lat * Math.PI) / 180;
  const dp = p2 - p1;
  const dl = ((b.lon - a.lon) * Math.PI) / 180;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * radius * Math.asin(Math.sqrt(h));
}

/**
 * Whether the step from one GPS sample to the next crossed a recording gap. A tunnel is
 * not one: the signal went but the distance was still counted. Nor is a short pause.
 */
export function isRecordingGap(before: GpsSample, after: GpsSample): boolean {
  if (after.elapsedS - before.elapsedS < GAP_MIN_SECONDS) return false;
  const straight = metresBetween(before, after);
  if (straight < GAP_MIN_METRES) return false;
  if (before.distanceM === null || after.distanceM === null) return true;
  return after.distanceM - before.distanceM < GAP_RECORDED_SHARE * straight;
}
