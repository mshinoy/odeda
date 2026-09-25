// The all-activities heatmap over a basemap. Lazily loaded by MapPage, because deck.gl
// and the map library are large and the rest of the view does not need them.
import { useMemo, useState } from "react";
import type { LayersList } from "@deck.gl/core";
import type { Heatmap } from "@/api/adapters";
import { useTheme, useTokens } from "@/design/theme";
import { DensityLegend } from "@/features/map/DensityLegend";
import { BaseMap } from "@/map/BaseMap";
import { heatmapBounds, makeHeatmapLayer } from "@/map/layers/makeHeatmapLayer";

/** Rendered only for a grid with cells in it, so the bounds below always exist. */
export function HeatmapView({ heatmap }: { heatmap: Heatmap }) {
  const theme = useTheme();
  const tokens = useTokens();

  const bounds = useMemo(() => heatmapBounds(heatmap.cells), [heatmap.cells]);
  // The map reads its opening view once; a later filter is a fitBounds instead.
  const [initialBounds] = useState(bounds);

  const layer = useMemo(
    () => makeHeatmapLayer({ heatmap, tokens, theme }),
    [heatmap, tokens, theme],
  );
  const layers: LayersList = useMemo(() => [layer], [layer]);

  if (initialBounds === null) return null;

  return (
    <div className="relative h-full w-full">
      <BaseMap layers={layers} initialBounds={initialBounds} fitBounds={bounds} />
      <div className="absolute bottom-3 left-3">
        <DensityLegend tokens={tokens} />
      </div>
    </div>
  );
}
