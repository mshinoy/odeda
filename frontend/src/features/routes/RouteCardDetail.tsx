import { Link } from "react-router-dom";
import { useRoute } from "@/api/queries/useRoute";
import { Skeleton } from "@/components/ui/skeleton";
import type { RouteRowView } from "@/features/routes/routeRowView";
import { MergeRoutesDialog } from "@/features/routes/MergeRoutesDialog";
import { RenameRouteDialog } from "@/features/routes/RenameRouteDialog";
import { SplitRouteDialog } from "@/features/routes/SplitRouteDialog";
import { formatDistance } from "@/lib/format";

/**
 * An opened route card: the corrections, without leaving the list.
 *
 * Tidying routes is the job this list exists for — two entries that are the same loop,
 * one that is two. Doing it from the route's own page meant opening a route, merging,
 * going back, and hunting for your place again.
 *
 * The detail is fetched here rather than with the list: `SplitRouteDialog` needs every
 * attempt, and 53 cards asking for that on arrival would be 53 requests for data almost
 * none of them would show.
 */
export function RouteCardDetail({ row }: { row: RouteRowView }) {
  const { data: detail, error } = useRoute(row.id);

  return (
    <div className="flex flex-col gap-3 border-t px-4 py-3">
      {error && <p className="text-delta-bad text-sm">{error.message}</p>}

      <dl className="text-muted-foreground flex flex-wrap gap-x-6 gap-y-1 text-xs">
        <Fact label="First run" value={row.first} />
        <Fact label="Last run" value={row.last} />
        <Fact
          label="Climb"
          value={
            detail
              ? detail.route.elevationGainM === null
                ? "—"
                : formatDistance(detail.route.elevationGainM)
              : "…"
          }
        />
      </dl>

      {/* Above the card's own click target, so pressing a button does not fold the
          card shut underneath the dialog it just opened. */}
      <div className="relative z-10 flex flex-wrap items-center gap-2">
        {detail ? (
          <>
            <RenameRouteDialog routeId={row.id} currentName={row.name} />
            <MergeRoutesDialog routeId={row.id} activityType={row.activityType} />
            <SplitRouteDialog routeId={row.id} attempts={detail.attempts} />
          </>
        ) : (
          <Skeleton className="h-9 w-64" />
        )}
        <Link
          to={row.href}
          className="text-muted-foreground hover:text-foreground ml-auto text-xs underline underline-offset-4"
        >
          Open the route page
        </Link>
      </div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-1">
      <dt>{label}</dt>
      <dd className="text-foreground tabular-nums">{value}</dd>
    </div>
  );
}
