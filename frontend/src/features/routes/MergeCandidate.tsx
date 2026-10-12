import { Map } from "lucide-react";
import type { RouteListItem } from "@/api/adapters";
import { kindColor } from "@/design/scales";
import { useTokens } from "@/design/theme";
import { formatDistance, formatInteger, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import { RoutePreview } from "@/map/RoutePreview";

const THUMB_W = 96;
const THUMB_H = 72;

export interface MergeCandidateProps {
  route: RouteListItem;
  /** Shared ground, 0..1. */
  similarity: number;
  metresAway: number;
  selected: boolean;
  onToggle: () => void;
}

/**
 * One route offered for a merge: its map, its name, and how alike it is.
 *
 * The map is the point. The routes are auto-named from their distance, so a list of
 * `3.6 km loop #9` is thirty names that say nothing about whether two are the same
 * loop. Two pictures side by side answer it at a glance.
 */
export function MergeCandidate({
  route,
  similarity,
  metresAway,
  selected,
  onToggle,
}: MergeCandidateProps) {
  const tokens = useTokens();

  return (
    <label
      className={cn(
        "flex cursor-pointer items-center gap-3 rounded-lg border p-2 transition-colors",
        selected ? "border-foreground/40 bg-muted/60" : "hover:bg-muted/40",
      )}
    >
      <input
        type="checkbox"
        className="accent-foreground size-4 shrink-0"
        checked={selected}
        onChange={onToggle}
      />

      <div className="bg-muted relative h-[72px] w-[96px] shrink-0 overflow-hidden rounded">
        {route.polyline ? (
          <RoutePreview
            polyline={route.polyline}
            color={kindColor(tokens, route.kind)}
            width={THUMB_W}
            height={THUMB_H}
          />
        ) : (
          <div className="text-muted-foreground flex h-full items-center justify-center">
            <Map className="size-5" aria-hidden />
          </div>
        )}
      </div>

      <div className="flex min-w-0 flex-col gap-0.5 text-sm">
        <span className="truncate font-medium">{route.name}</span>
        <span className="text-muted-foreground text-xs">
          {formatInteger(route.attempts)} × {formatDistance(route.distanceM)}
        </span>
        <span className="text-muted-foreground text-xs">
          {/* Zero shared ground is the usual answer: anything above the clusterer's
              threshold is already one route. The distance is what ranks them then. */}
          {formatPercent(similarity * 100)} shared · {describeGap(metresAway)} away
        </span>
      </div>
    </label>
  );
}

function describeGap(metres: number): string {
  return metres < 1000 ? `${Math.round(metres)} m` : formatDistance(metres);
}
