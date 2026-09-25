import { Link } from "react-router-dom";
import { useActivityTypes } from "@/api/queries/useActivityTypes";
import { useHeatmap } from "@/api/queries/useHeatmap";
import { HeatmapPanel } from "@/features/map/HeatmapPanel";
import { MapFilters } from "@/features/map/MapFilters";
import { hasFilters, NO_FILTERS, toHeatmapParams } from "@/features/map/mapState";
import { useMapState } from "@/features/map/useMapState";

/** Where you have been: every recorded GPS point, as density. */
export function MapPage() {
  const { state, update } = useMapState();
  const types = useActivityTypes();
  const heatmap = useHeatmap(toHeatmapParams(state));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <MapFilters state={state} types={types.data ?? []} onChange={update} />
        <Link
          to="/routes"
          className="text-muted-foreground hover:text-foreground ml-auto text-sm transition-colors"
        >
          Routes
        </Link>
      </div>
      {/* The map is the hero: as tall as the window leaves it, once the nav and filters have theirs. */}
      <section className="relative h-[calc(100svh-15rem)] min-h-[360px] overflow-hidden rounded-xl border">
        <HeatmapPanel
          heatmap={heatmap.data}
          error={heatmap.error}
          filtered={hasFilters(state)}
          onClearFilters={() => update(NO_FILTERS)}
        />
      </section>
    </div>
  );
}
