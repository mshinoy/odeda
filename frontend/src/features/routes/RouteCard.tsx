import { Link } from "react-router-dom";
import { KindBadge } from "@/components/KindBadge";
import { kindColor } from "@/design/scales";
import { useTokens } from "@/design/theme";
import type { RouteRowView } from "@/features/routes/routeRowView";
import { Map } from "lucide-react";
import { RoutePreview } from "@/map/RoutePreview";

/** The picture's size on a wide screen, in CSS pixels; it fills the card's width below. */
export const VISUAL_WIDTH = 240;
export const VISUAL_HEIGHT = 180;

/**
 * One route, landscape: its shape on the left, its numbers on the right — the activity
 * card's layout, because a route list without the shape names nothing the owner knows.
 * The routes are auto-named from their distance (`1.6 km loop #31`), so the map is the
 * only thing on the card that identifies the loop.
 */
export function RouteCard({ row }: { row: RouteRowView }) {
  const tokens = useTokens();

  return (
    <article className="bg-card hover:border-foreground/25 relative flex flex-col overflow-hidden rounded-xl border transition-colors sm:flex-row">
      {/* The picture fills the panel and never sizes it: the numbers set the height. */}
      <div className="bg-muted relative aspect-[4/3] w-full shrink-0 sm:aspect-auto sm:min-h-[180px] sm:w-[240px]">
        <div className="absolute inset-0">
          {row.polyline ? (
            <RoutePreview
              polyline={row.polyline}
              color={kindColor(tokens, row.kind)}
              width={VISUAL_WIDTH}
              height={VISUAL_HEIGHT}
            />
          ) : (
            <div className="text-muted-foreground flex h-full items-center justify-center">
              <Map className="size-8" aria-hidden />
            </div>
          )}
        </div>
      </div>

      <div className="@container flex min-w-0 flex-1 flex-col gap-3 p-4">
        <header className="flex min-w-0 flex-col gap-0.5">
          <Link
            to={row.href}
            className="focus-visible:after:ring-ring truncate font-medium after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset"
          >
            {row.name}
          </Link>
          <div className="text-muted-foreground flex flex-wrap items-center gap-x-2 text-xs">
            <KindBadge kind={row.kind} label={row.typeLabel} />
            <span aria-hidden>·</span>
            <span>{row.shape}</span>
            <span aria-hidden>·</span>
            <span>last {row.last}</span>
          </div>
        </header>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 @md:grid-cols-4">
          <Stat label="Attempts" value={row.attempts} />
          <Stat label="Distance" value={row.distance} />
          {/* Round a loop these are lap times, not attempt times (T44). */}
          <Stat label="Best" value={row.best} />
          <Stat label="Median" value={row.median} />
        </dl>
      </div>
    </article>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="truncate text-lg font-semibold tracking-tight tabular-nums">{value}</dd>
    </div>
  );
}
