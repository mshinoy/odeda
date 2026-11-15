import { lazy, Suspense } from "react";
import { useRoute, useRouteSegments } from "@/api/queries/useRoute";
import { EmptyState } from "@/components/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";

const RouteMap = lazy(() =>
  import("@/features/routes/RouteMap").then((m) => ({ default: m.RouteMap })),
);

/** The chosen route on the map, drawn by how fast each stretch goes. */
export function SelectedRouteMap({ routeId }: { routeId: number }) {
  const { data: detail, error } = useRoute(routeId);
  const { data: segments } = useRouteSegments(routeId);

  if (error) return <EmptyState message="This route no longer exists." />;
  if (!detail || segments === undefined) return <Skeleton className="h-full w-full rounded-none" />;

  return (
    <Suspense fallback={<Skeleton className="h-full w-full rounded-none" />}>
      {/* Keyed, so choosing another route opens the map on it rather than flying there. */}
      <RouteMap key={routeId} route={detail.route} segments={segments} />
    </Suspense>
  );
}
