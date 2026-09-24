// The route map on the single-activity page. Hover is shared with the charts through
// the UI store: hovering the route writes the stream index, and the cursor dot follows
// whatever index is hovered, here or on a chart.
import { useCallback, useMemo, useState } from "react";
import type { LayersList, PickingInfo } from "@deck.gl/core";
import type { Activity } from "@/api/adapters";
import { useTheme, useTokens } from "@/design/theme";
import type { MetricKey } from "@/lib/metrics";
import { BaseMap } from "@/map/BaseMap";
import {
  activityMetricRange,
  makeCursorLayer,
  makeRouteLayer,
  pickedStreamIndex,
  routeBounds,
} from "@/map/layers/makeRouteLayer";
import { MetricLegend } from "@/map/MetricLegend";
import { useUiStore } from "@/store/ui";

interface ActivityMapProps {
  activity: Activity;
  colorBy: MetricKey;
}

export function ActivityMap({ activity, colorBy }: ActivityMapProps) {
  const theme = useTheme();
  const tokens = useTokens();
  const hover = useUiStore((state) => state.hover);
  const setHover = useUiStore((state) => state.setHover);
  const clearHover = useUiStore((state) => state.clearHover);
  const [pointerOnRoute, setPointerOnRoute] = useState(false);

  const track = activity.track;
  const activityId = activity.summary.id;

  const initialBounds = useMemo(() => (track ? routeBounds(track) : null), [track]);
  const legendRange = useMemo(() => activityMetricRange(activity, colorBy), [activity, colorBy]);

  // Route data only depends on these, so a hover never rebuilds it.
  const routeLayer = useMemo(
    () => makeRouteLayer({ activity, colorBy, tokens, theme }),
    [activity, colorBy, tokens, theme],
  );
  const cursorLayer = useMemo(
    () => makeCursorLayer({ activity, hover, tokens }),
    [activity, hover, tokens],
  );
  const layers: LayersList = useMemo(() => [routeLayer, cursorLayer], [routeLayer, cursorLayer]);

  const handleHover = useCallback(
    (info: PickingInfo) => {
      const streamIndex = pickedStreamIndex(info);
      setPointerOnRoute(streamIndex !== null);
      if (streamIndex !== null) {
        setHover({ activityId, index: streamIndex });
      } else if (useUiStore.getState().hover !== null) {
        clearHover();
      }
    },
    [activityId, setHover, clearHover],
  );

  const handleLeave = useCallback(() => {
    setPointerOnRoute(false);
    clearHover();
  }, [clearHover]);

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
