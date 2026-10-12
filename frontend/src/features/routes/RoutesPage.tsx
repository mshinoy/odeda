import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useRouteList } from "@/api/queries/useRoutes";
import { EmptyState } from "@/components/EmptyState";
import { MapAttribution } from "@/components/MapAttribution";
import { Skeleton } from "@/components/ui/skeleton";
import { toRouteRowView } from "@/features/routes/routeRowView";
import { RouteCard } from "@/features/routes/RouteCard";
import { mapEnv, providerFor } from "@/map/basemap";

/** Your recurring loops: every clustered route, the one you run most at the top. */
export function RoutesPage() {
  const { data, error } = useRouteList();
  const rows = useMemo(() => data?.map((route) => toRouteRowView(route)), [data]);

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
      <div className="flex flex-col gap-3">
        {rows
          ? rows.map((row) => <RouteCard key={row.id} row={row} />)
          : SKELETONS.map((key) => <Skeleton key={key} className="h-[180px] rounded-xl" />)}
      </div>
      {/* The card images carry no logo of their own, so the credit goes here (D14). */}
      {providerFor(mapEnv) === "mapbox" && <MapAttribution />}
    </div>
  );
}

const SKELETONS = Array.from({ length: 6 }, (_, i) => i);
