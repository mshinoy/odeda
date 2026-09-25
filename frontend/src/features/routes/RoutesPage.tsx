import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useRouteList } from "@/api/queries/useRoutes";
import { EmptyState } from "@/components/EmptyState";
import { toRouteRowView } from "@/features/routes/routeRowView";
import { RouteTable } from "@/features/routes/RouteTable";

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

  return <RouteTable rows={rows} />;
}
