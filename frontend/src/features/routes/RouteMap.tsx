// The route drawn segment by segment, coloured by how fast that stretch usually goes.
// Lazily loaded by RoutePage: deck.gl and the map library are large.
import { useCallback, useMemo, useState } from "react";
import type { LayersList, PickingInfo } from "@deck.gl/core";
import { bbox } from "@turf/turf";
import type { Route, RouteSegment } from "@/api/adapters";
import { useTheme, useTokens } from "@/design/theme";
import { SegmentTooltip } from "@/features/routes/SegmentTooltip";
import { BaseMap } from "@/map/BaseMap";
import {
  makeRouteOutlineLayer,
  makeSegmentLayer,
  pickedSegment,
  segmentSpeedRange,
} from "@/map/layers/makeSegmentLayer";
import { RampLegend } from "@/map/RampLegend";
import type { MapBounds } from "@/map/types";
import { formatRelative } from "@/lib/format";

interface RouteMapProps {
  route: Route;
  segments: readonly RouteSegment[];
}

export function RouteMap({ route, segments }: RouteMapProps) {
  const theme = useTheme();
  const tokens = useTokens();
  const [hovered, setHovered] = useState<RouteSegment | null>(null);

  const initialBounds = useMemo(() => routeBounds(route), [route]);
  const range = useMemo(() => segmentSpeedRange(segments), [segments]);
  const outline = useMemo(() => makeRouteOutlineLayer(route, tokens), [route, tokens]);
  const layer = useMemo(
    () => makeSegmentLayer({ segments, tokens, theme }),
    [segments, tokens, theme],
  );
  // The outline goes under: a stretch with no profile still reads as part of the route.
  const layers: LayersList = useMemo(() => [outline, layer], [outline, layer]);

  const handleHover = useCallback((info: PickingInfo) => setHovered(pickedSegment(info)), []);
  const handleLeave = useCallback(() => setHovered(null), []);

  return (
    <div className="relative h-full w-full">
      <BaseMap
        layers={layers}
        initialBounds={initialBounds}
        onHover={handleHover}
        onLeave={handleLeave}
        cursor={hovered ? "pointer" : undefined}
      />
      {range && (
        <div className="absolute bottom-3 left-3">
          <RampLegend
            low={formatRelative(range[0])}
            high={formatRelative(range[1])}
            label="Speed against your own average here"
            tokens={tokens}
          />
        </div>
      )}
      {hovered && (
        <div className="absolute top-3 left-3">
          <SegmentTooltip segment={hovered} kind={route.kind} />
        </div>
      )}
    </div>
  );
}

function routeBounds(route: Route): MapBounds {
  const [minLon, minLat, maxLon, maxLat] = bbox({ type: "LineString", coordinates: route.path });
  return [
    [minLon, minLat],
    [maxLon, maxLat],
  ];
}
