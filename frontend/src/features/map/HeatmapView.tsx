// The all-activities heatmap over a basemap. Lazily loaded by MapPage, because deck.gl
// and the map library are large and the rest of the view does not need them.
import { useEffect, useMemo, useState } from "react";
import type { LayersList } from "@deck.gl/core";
import type { Heatmap } from "@/api/adapters";
import { useTheme, useTokens } from "@/design/theme";
import { DensityLegend } from "@/features/map/DensityLegend";
import { rememberBounds } from "@/features/map/lastBounds";
import { BaseMap } from "@/map/BaseMap";
import { heatmapBounds } from "@/map/heatmapBounds";
import { makeHeatmapLayer } from "@/map/layers/makeHeatmapLayer";
import type { MapBounds } from "@/map/types";

interface HeatmapViewProps {
  /** Undefined while the grid loads: the map is already up, the heat comes after. */
  heatmap: Heatmap | undefined;
  /** Where the map opens: the grid's own box, or where it last was while it loads. */
  openingBounds: MapBounds;
}

export function HeatmapView({ heatmap, openingBounds }: HeatmapViewProps) {
  const theme = useTheme();
  const tokens = useTokens();

  const bounds = useMemo(() => (heatmap ? heatmapBounds(heatmap.cells) : null), [heatmap]);
  // The map reads its opening view once; the grid's box, and a later filter, fit to it.
  const [initialBounds] = useState(openingBounds);
  useEffect(() => {
    if (bounds) rememberBounds(bounds);
  }, [bounds]);

  const layers: LayersList = useMemo(
    () => (heatmap ? [makeHeatmapLayer({ heatmap, tokens, theme })] : []),
    [heatmap, tokens, theme],
  );

  return (
    <div className="relative h-full w-full">
      <BaseMap layers={layers} initialBounds={initialBounds} fitBounds={bounds} />
      {heatmap ? (
        <div className="absolute bottom-3 left-3">
          <DensityLegend tokens={tokens} />
        </div>
      ) : (
        <div className="bg-background/80 text-muted-foreground absolute top-3 left-3 animate-pulse rounded-md px-2 py-1 text-xs">
          Loading
        </div>
      )}
    </div>
  );
}
