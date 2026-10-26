import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useRouteList } from "@/api/queries/useRoutes";
import { EmptyState } from "@/components/EmptyState";
import { MapAttribution } from "@/components/MapAttribution";
import { Skeleton } from "@/components/ui/skeleton";
import { filterByKind, kindOptions, parseKind } from "@/features/routes/routeFilter";
import { RouteKindFilter } from "@/features/routes/RouteKindFilter";
import { toRouteRowView } from "@/features/routes/routeRowView";
import { RouteCard } from "@/features/routes/RouteCard";
import { mapEnv, providerFor } from "@/map/basemap";

/** Your recurring loops: every clustered route, the one you run most at the top. */
export function RoutesPage() {
  const { data, error } = useRouteList();
  const rows = useMemo(() => data?.map((route) => toRouteRowView(route)), [data]);
  // The opened card lives in the URL, like the plan's opened week: a route worth
  // looking at is a route worth sending to yourself.
  const [params, setParams] = useSearchParams();
  const open = Number(params.get("route")) || null;
  const kind = parseKind(params.get("kind"));

  const options = useMemo(() => (rows ? kindOptions(rows) : []), [rows]);
  const shown = useMemo(() => (rows ? filterByKind(rows, kind) : undefined), [rows, kind]);

  /** The filter and the open card share the URL, so neither clears the other. */
  const patch = (next: Record<string, string | null>) => {
    const merged = new URLSearchParams(params);
    for (const [key, value] of Object.entries(next)) {
      if (value === null) merged.delete(key);
      else merged.set(key, value);
    }
    // `preventScrollReset`: the shell's ScrollRestoration would otherwise send the page to
    // the top on every URL change, including opening a card halfway down the list.
    setParams(merged, { replace: true, preventScrollReset: true });
  };
  const toggle = (id: number) => patch({ route: open === id ? null : String(id) });

  if (error) return <EmptyState message={error.message} />;
  if (rows?.length === 0) {
    return (
      <EmptyState
        message="No routes yet. They appear once two activities follow the same track."
        action={
          <Link to="/map" className="text-foreground underline underline-offset-4">
            Map
          </Link>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <RouteKindFilter
        options={options}
        value={kind}
        total={rows?.length ?? 0}
        onChange={(next) => patch({ kind: next })}
      />

      <div className="flex flex-col gap-3">
        {shown
          ? shown.map((row) => (
              <RouteCard
                key={row.id}
                row={row}
                open={open === row.id}
                onToggle={() => toggle(row.id)}
              />
            ))
          : SKELETONS.map((key) => <Skeleton key={key} className="h-[180px] rounded-xl" />)}
        {shown?.length === 0 && (
          // Only reachable from a stale link: the control offers no empty kind.
          <p className="text-muted-foreground py-6 text-center text-sm">
            No routes of that kind.{" "}
            <button
              type="button"
              className="underline underline-offset-4"
              onClick={() => patch({ kind: null })}
            >
              Show all
            </button>
          </p>
        )}
      </div>
      {/* The card images carry no logo of their own, so the credit goes here (D14). */}
      {providerFor(mapEnv) === "mapbox" && <MapAttribution />}
    </div>
  );
}

const SKELETONS = Array.from({ length: 6 }, (_, i) => i);
