import { lazy, Suspense } from "react";
import type { Heatmap } from "@/api/adapters";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { supportsWebGL } from "@/map/webgl";

// deck.gl and the map libraries are large; load them only when a page shows a map.
const HeatmapView = lazy(() =>
  import("@/features/map/HeatmapView").then((m) => ({ default: m.HeatmapView })),
);

interface HeatmapPanelProps {
  /** Undefined until the first grid arrives. */
  heatmap: Heatmap | undefined;
  error: Error | null;
  filtered: boolean;
  onClearFilters: () => void;
}

/** The map, or a skeleton while it loads, or one line about why there is nothing. */
export function HeatmapPanel({ heatmap, error, filtered, onClearFilters }: HeatmapPanelProps) {
  if (!supportsWebGL()) {
    return <EmptyState message="Maps need WebGL. Turn on hardware acceleration in the browser." />;
  }
  if (error) return <EmptyState message={error.message} />;
  if (!heatmap) return <Skeleton className="h-full w-full rounded-none" />;

  if (heatmap.cells.length === 0) {
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

  return (
    <Suspense fallback={<Skeleton className="h-full w-full rounded-none" />}>
      <HeatmapView heatmap={heatmap} />
    </Suspense>
  );
}
