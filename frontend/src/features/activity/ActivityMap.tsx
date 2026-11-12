// The route map on the single-activity page. Hover is shared with the charts through
// the UI store: hovering the route writes the stream index, and the cursor dot follows
// whatever index is hovered, here, on a chart, or from route playback.
import { useCallback, useEffect, useMemo, useState } from "react";
import type { LayersList, PickingInfo } from "@deck.gl/core";
import { withPaceWindow, type Activity, type ActivityGap } from "@/api/adapters";
import { useTheme, useTokens } from "@/design/theme";
import { indexAtElapsed } from "@/features/activity/playback";
import type { Playback } from "@/features/activity/usePlayback";
import type { MetricKey } from "@/lib/metrics";
import { BaseMap } from "@/map/BaseMap";
import {
  activityMetricRange,
  makeCursorLayer,
  makeRouteLayer,
  pickedStreamIndex,
  routeBounds,
} from "@/map/layers/makeRouteLayer";
import { makeGapLayer } from "@/map/layers/makeGapLayer";
import { activityTrips, makeTripsLayer } from "@/map/layers/makeTripsLayer";
import { MetricLegend } from "@/map/MetricLegend";
import { useUiStore } from "@/store/ui";

interface ActivityMapProps {
  activity: Activity;
  colorBy: MetricKey;
  playback: Playback;
  /** Stretches the watch did not record, drawn dashed where a path is known. */
  gaps?: readonly ActivityGap[];
}

// One empty list for every render, so no gaps never looks like new data to a memo.
const NO_GAPS: readonly ActivityGap[] = [];

const ROUTE_PACE_WINDOW_S = 90;

export function ActivityMap({ activity, colorBy, playback, gaps = NO_GAPS }: ActivityMapProps) {
  const theme = useTheme();
  const tokens = useTokens();
  const hover = useUiStore((state) => state.hover);
  const setHover = useUiStore((state) => state.setHover);
  const clearHover = useUiStore((state) => state.clearHover);
  const [pointerOnRoute, setPointerOnRoute] = useState(false);

  const track = activity.track;
  const activityId = activity.summary.id;
  const elapsedS = activity.streams.elapsedS;
  // Playback owns the cursor once it has been started or scrubbed, and gives it back
  // only when it is rewound to the start.
  const replaying = playback.playing || playback.currentS > 0;

  const initialBounds = useMemo(() => (track ? routeBounds(track) : null), [track]);
  // The colours use a calmer pace than the hover does, so the walk breaks of a run and
  // walk session read as stretches of the route, not as one colour change per few metres.
  const coloured = useMemo(
    () => ({ ...activity, streams: withPaceWindow(activity.streams, ROUTE_PACE_WINDOW_S) }),
    [activity],
  );
  const legendRange = useMemo(() => activityMetricRange(coloured, colorBy), [coloured, colorBy]);
  const trips = useMemo(() => activityTrips(activity), [activity]);

  // Route data only depends on these, so a hover never rebuilds it.
  const routeLayer = useMemo(
    () => makeRouteLayer({ activity: coloured, colorBy, tokens, theme }),
    [coloured, colorBy, tokens, theme],
  );
  const tripsLayer = useMemo(
    () =>
      replaying
        ? makeTripsLayer({
            trips,
            currentTime: playback.currentS,
            kind: activity.summary.kind,
            tokens,
          })
        : null,
    [trips, replaying, playback.currentS, activity.summary.kind, tokens],
  );
  const cursorLayer = useMemo(
    () => makeCursorLayer({ activity, hover, tokens }),
    [activity, hover, tokens],
  );
  const gapLayer = useMemo(() => makeGapLayer(gaps, tokens), [gaps, tokens]);
  const layers: LayersList = useMemo(
    () => [gapLayer, routeLayer, tripsLayer, cursorLayer],
    [gapLayer, routeLayer, tripsLayer, cursorLayer],
  );

  // The charts' crosshair follows the replay, because both read the same hover.
  useEffect(() => {
    if (!replaying) return;
    setHover({ activityId, index: indexAtElapsed(elapsedS, playback.currentS) });
  }, [replaying, playback.currentS, activityId, elapsedS, setHover]);

  const handleHover = useCallback(
    (info: PickingInfo) => {
      const streamIndex = pickedStreamIndex(info);
      setPointerOnRoute(streamIndex !== null);
      if (streamIndex !== null) {
        setHover({ activityId, index: streamIndex });
      } else if (!replaying && useUiStore.getState().hover !== null) {
        clearHover();
      }
    },
    [activityId, replaying, setHover, clearHover],
  );

  const handleLeave = useCallback(() => {
    setPointerOnRoute(false);
    if (!replaying) clearHover();
  }, [replaying, clearHover]);

  if (initialBounds === null) return null;

  return (
    <div className="relative h-full w-full">
      <BaseMap
        layers={layers}
        initialBounds={initialBounds}
        onHover={handleHover}
        onLeave={handleLeave}
        cursor={pointerOnRoute ? "pointer" : undefined}
      />
      {legendRange && (
        <div className="absolute bottom-3 left-3">
          <MetricLegend
            colorBy={colorBy}
            range={legendRange}
            kind={activity.summary.kind}
            tokens={tokens}
          />
        </div>
      )}
    </div>
  );
}
