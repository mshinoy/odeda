import { lazy, Suspense, useEffect, useState } from "react";
import type { Heatmap } from "@/api/adapters";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { readLastBounds } from "@/features/map/lastBounds";
import { preloadBaseMap } from "@/map/BaseMap";
import { heatmapBounds } from "@/map/heatmapBounds";
import { supportsWebGL } from "@/map/webgl";

// deck.gl and the map libraries are large; load them only when a page shows a map, but
// as soon as it does, not after the data: the two downloads overlap instead of queueing.
const loadHeatmapView = () =>
  import("@/features/map/HeatmapView").then((m) => ({ default: m.HeatmapView }));
const HeatmapView = lazy(loadHeatmapView);

interface HeatmapPanelProps {
  /** Undefined until the first grid arrives. */
  heatmap: Heatmap | undefined;
  error: Error | null;
  filtered: boolean;
  onClearFilters: () => void;
}

/**
 * The map, or one line about why there is nothing. While the grid loads, the map opens
 * where it last was and the heat is drawn on it when it comes; on a first visit, with
 * nowhere remembered, a skeleton waits for the grid.
 */
export function HeatmapPanel({ heatmap, error, filtered, onClearFilters }: HeatmapPanelProps) {
  const [lastBounds] = useState(readLastBounds);
  useEffect(() => {
    void loadHeatmapView();
    preloadBaseMap();
  }, []);

  if (!supportsWebGL()) {
    return <EmptyState message="Maps need WebGL. Turn on hardware acceleration in the browser." />;
  }
  if (error) return <EmptyState message={error.message} />;

  if (heatmap?.cells.length === 0) {
    if (!filtered) return <EmptyState message="No GPS points yet. Run a sync to pull them in." />;
    return (
      <EmptyState
        message="No GPS points match these filters."
        action={
          <Button variant="outline" size="sm" onClick={onClearFilters}>
            Clear filters
          </Button>
        }
      />
    );
  }

  const openingBounds = heatmap ? heatmapBounds(heatmap.cells) : lastBounds;
  if (!openingBounds) return <Skeleton className="h-full w-full rounded-none" />;

  return (
    <Suspense fallback={<Skeleton className="h-full w-full rounded-none" />}>
      <HeatmapView heatmap={heatmap} openingBounds={openingBounds} />
    </Suspense>
  );
}
