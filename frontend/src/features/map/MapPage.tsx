import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useActivityTypes } from "@/api/queries/useActivityTypes";
import { useHeatmap } from "@/api/queries/useHeatmap";
import { useRouteList } from "@/api/queries/useRoutes";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { HeatmapPanel } from "@/features/map/HeatmapPanel";
import { MapFilters } from "@/features/map/MapFilters";
import {
  hasFilters,
  NO_FILTERS,
  serializeMapState,
  toHeatmapParams,
  type MapState,
} from "@/features/map/mapState";
import { MapAttribution } from "@/components/MapAttribution";
import { RouteListItem } from "@/features/map/RouteListItem";
import { SelectedRouteMap } from "@/features/map/SelectedRouteMap";
import { useMapState } from "@/features/map/useMapState";
import { filterByKind, kindOptions, parseKind } from "@/features/routes/routeFilter";
import { RouteKindFilter } from "@/features/routes/RouteKindFilter";
import { toRouteRowView } from "@/features/routes/routeRowView";
import { mapEnv, providerFor } from "@/map/basemap";

/**
 * Where you run: your routes on the right, the map on the left. With none chosen the map
 * is every GPS point as density; choosing a route draws that route instead.
 */
export function MapPage() {
  const { state } = useMapState();
  const types = useActivityTypes();
  const heatmap = useHeatmap(toHeatmapParams(state));
  const routes = useRouteList();

  // The chosen route and the kind filter share the URL with the heat map's filters, so a
  // route is as sendable as a place.
  const [params, setParams] = useSearchParams();
  const selected = Number(params.get("route")) || null;
  const kind = parseKind(params.get("kind"));

  const rows = useMemo(() => routes.data?.map((route) => toRouteRowView(route)), [routes.data]);
  const options = useMemo(() => (rows ? kindOptions(rows) : []), [rows]);
  const shown = useMemo(() => (rows ? filterByKind(rows, kind) : undefined), [rows, kind]);

  const patch = (next: Record<string, string | null>) => {
    const merged = new URLSearchParams(params);
    for (const [key, value] of Object.entries(next)) {
      if (value === null) merged.delete(key);
      else merged.set(key, value);
    }
    setParams(merged, { replace: true, preventScrollReset: true });
  };
  /** The heat map's filters keep the kind filter; they only own their own three keys. */
  const updateFilters = (next: MapState) => {
    const merged = serializeMapState(next);
    if (kind) merged.set("kind", kind);
    setParams(merged);
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <section className="bg-card shadow-card relative h-[60svh] min-h-[360px] overflow-hidden rounded-2xl border lg:h-[calc(100svh-11rem)]">
        {selected ? (
          <SelectedRouteMap routeId={selected} />
        ) : (
          <HeatmapPanel
            heatmap={heatmap.data}
            error={heatmap.error}
            filtered={hasFilters(state)}
            onClearFilters={() => updateFilters(NO_FILTERS)}
          />
        )}
      </section>

      <aside className="bg-card shadow-card flex max-h-[70svh] flex-col gap-3 overflow-hidden rounded-2xl border p-4 lg:h-[calc(100svh-11rem)] lg:max-h-none">
        <header className="flex flex-col gap-1">
          <h1 className="text-lg font-semibold tracking-tight">Routes</h1>
          <p className="text-muted-foreground text-xs">
            {selected
              ? "Drawn by how fast each stretch goes."
              : "Choose one to draw it. Until then: everywhere you have been."}
          </p>
        </header>

        {selected ? (
          <Button
            variant="outline"
            size="sm"
            className="self-start"
            onClick={() => patch({ route: null })}
          >
            Show everywhere I have been
          </Button>
        ) : (
          <MapFilters state={state} types={types.data ?? []} onChange={updateFilters} />
        )}

        <RouteKindFilter
          options={options}
          value={kind}
          total={rows?.length ?? 0}
          onChange={(next) => patch({ kind: next })}
        />

        <ul className="-mx-1 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-1">
          {shown
            ? shown.map((row) => (
                <RouteListItem
                  key={row.id}
                  row={row}
                  selected={selected === row.id}
                  onSelect={() => patch({ route: selected === row.id ? null : String(row.id) })}
                />
              ))
            : SKELETONS.map((key) => <Skeleton key={key} className="h-[72px] rounded-xl" />)}
          {rows?.length === 0 && (
            <li className="text-muted-foreground py-6 text-center text-sm">
              No routes yet. They appear once two activities follow the same track.
            </li>
          )}
        </ul>
        {providerFor(mapEnv) === "mapbox" && <MapAttribution />}
      </aside>
    </div>
  );
}

const SKELETONS = Array.from({ length: 6 }, (_, i) => i);
