import { ChevronDown, Map } from "lucide-react";
import { KindBadge } from "@/components/KindBadge";
import { kindColor } from "@/design/scales";
import { useTokens } from "@/design/theme";
import { RouteCardDetail } from "@/features/routes/RouteCardDetail";
import type { RouteRowView } from "@/features/routes/routeRowView";
import { RoutePreview } from "@/map/RoutePreview";
import { cn } from "@/lib/utils";

/** The picture's size on a wide screen, in CSS pixels; it fills the card's width below. */
export const VISUAL_WIDTH = 240;
export const VISUAL_HEIGHT = 180;

/**
 * One route, landscape: its shape on the left, its numbers on the right — the activity
 * card's layout, because a route list without the shape names nothing the owner knows.
 * The routes are auto-named from their distance (`1.6 km loop #31`), so the map is the
 * only thing on the card that identifies the loop.
 */
interface RouteCardProps {
  row: RouteRowView;
  open: boolean;
  onToggle: () => void;
}

export function RouteCard({ row, open, onToggle }: RouteCardProps) {
  const tokens = useTokens();

  return (
    <article
      className={cn(
        "bg-card hover:border-foreground/25 relative flex flex-col overflow-hidden rounded-xl border transition-colors",
        open && "border-foreground/25",
      )}
    >
      {/* The whole card opens it. A link stretched over the card would have meant a
          click either folding it or navigating, depending where it landed. */}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex flex-col text-left sm:flex-row"
      >
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
            <span className="flex items-center gap-2">
              <span className="truncate font-medium">{row.name}</span>
              <ChevronDown
                aria-hidden
                className={cn(
                  "text-muted-foreground size-4 shrink-0 transition-transform",
                  open && "rotate-180",
                )}
              />
            </span>
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
      </button>

      {open && <RouteCardDetail row={row} />}
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
