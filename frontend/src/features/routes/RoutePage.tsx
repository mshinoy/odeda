import { lazy, Suspense, useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { useRoute, useRouteSegments } from "@/api/queries/useRoute";
import { EmptyState } from "@/components/EmptyState";
import { KindBadge } from "@/components/KindBadge";
import { Skeleton } from "@/components/ui/skeleton";
import { AttemptsTable } from "@/features/routes/AttemptsTable";
import { toAttemptRows } from "@/features/routes/attemptRowView";
import { RouteStats } from "@/features/routes/RouteStats";
import { activityTypeLabel } from "@/lib/activityKind";
import { supportsWebGL } from "@/map/webgl";

const RouteMap = lazy(() =>
  import("@/features/routes/RouteMap").then((m) => ({ default: m.RouteMap })),
);

/** One route: where it is fast and slow, and every attempt at it. */
export function RoutePage() {
  const { id = "" } = useParams();
  const routeId = Number(id);
  const { data: detail, isPending, error } = useRoute(routeId);
  const { data: segments } = useRouteSegments(routeId);

  const rows = useMemo(
    () =>
      detail
        ? toAttemptRows(detail.attempts, {
            kind: detail.route.kind,
            stats: detail.stats,
            bestActivityId: detail.bestActivityId,
          })
        : [],
    [detail],
  );

  if (!Number.isInteger(routeId)) return <EmptyState message="No such route." />;
  if (error) return <EmptyState message={error.message} />;
  if (isPending || !detail) return <Skeleton className="h-96 w-full" />;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">{detail.route.name}</h1>
        <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <KindBadge
            kind={detail.route.kind}
            label={activityTypeLabel(detail.route.activityType)}
          />
          <span>{detail.route.isLoop ? "Loop" : "Out and back"}</span>
          <Link to="/routes" className="hover:text-foreground underline underline-offset-4">
            All routes
          </Link>
        </div>
      </div>

      <RouteStats detail={detail} />

      <section className="relative h-[420px] overflow-hidden rounded-xl border">
        {supportsWebGL() ? (
          <Suspense fallback={<Skeleton className="h-full w-full rounded-none" />}>
            {segments === undefined ? (
              <Skeleton className="h-full w-full rounded-none" />
            ) : (
              <RouteMap route={detail.route} segments={segments} />
            )}
          </Suspense>
        ) : (
          <EmptyState message="Maps need WebGL. Turn on hardware acceleration in the browser." />
        )}
      </section>

      <AttemptsTable rows={rows} />
    </div>
  );
}
