// The compared activities' tracks, one colour each, as a single deck.gl layer.
import { PathLayer } from "@deck.gl/layers";
import { bbox } from "@turf/turf";
import type { ComparedAttempt } from "@/api/adapters";
import { hexToRgba } from "@/design/scales";
import type { ColorTokens } from "@/design/tokens";
import type { MapBounds } from "@/map/types";

export const COMPARE_LAYER_ID = "compare-tracks";

const TRACK_WIDTH_PX = 3;

/** One compared track ready to draw: the whole line, in this activity's series colour. */
export interface ComparedTrack {
  id: string;
  color: string;
  path: [number, number][];
}

/**
 * The tracks to draw, in the order the activities were asked for, so the nth activity
 * always gets the nth series colour wherever it appears. Activities with no usable GPS
 * are left out; they still have charts.
 */
export function comparedTracks(
  attempts: readonly ComparedAttempt[],
  tokens: ColorTokens,
): ComparedTrack[] {
  const tracks: ComparedTrack[] = [];

  attempts.forEach((attempt, i) => {
    const track = attempt.track;
    const color = tokens.series[i % tokens.series.length];
    if (!track || color === undefined) return;
    tracks.push({
      id: attempt.activity.id,
      color,
      path: track.line.coordinates.flatMap(([lon, lat]) =>
        lon === undefined || lat === undefined ? [] : [[lon, lat] as [number, number]],
      ),
    });
  });

  return tracks;
}

/** The box every drawn track fits in, or null when none of them has GPS. */
export function comparedBounds(tracks: readonly ComparedTrack[]): MapBounds | null {
  const coordinates = tracks.flatMap((track) => track.path);
  if (coordinates.length === 0) return null;

  const [minLon, minLat, maxLon, maxLat] = bbox({ type: "LineString", coordinates });
  return [
    [minLon, minLat],
    [maxLon, maxLat],
  ];
}

/** The overlaid tracks; null when none of the compared activities has GPS. */
export function makeCompareLayer(
  tracks: readonly ComparedTrack[],
): PathLayer<ComparedTrack> | null {
  if (tracks.length === 0) return null;

  return new PathLayer<ComparedTrack>({
    id: COMPARE_LAYER_ID,
    data: tracks,
    getPath: (track) => track.path,
    getColor: (track) => hexToRgba(track.color),
    getWidth: TRACK_WIDTH_PX,
    widthUnits: "pixels",
    capRounded: true,
    jointRounded: true,
    pickable: false,
  });
}
