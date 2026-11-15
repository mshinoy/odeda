import { Map } from "lucide-react";
import { kindColor } from "@/design/scales";
import { useTokens } from "@/design/theme";
import { RouteCardDetail } from "@/features/routes/RouteCardDetail";
import type { RouteRowView } from "@/features/routes/routeRowView";
import { cn } from "@/lib/utils";
import { RoutePreview } from "@/map/RoutePreview";

const THUMB_WIDTH = 72;
const THUMB_HEIGHT = 56;

interface RouteListItemProps {
  row: RouteRowView;
  selected: boolean;
  onSelect: () => void;
}

/**
 * One route in the map's list: its shape, its name, and the three numbers that tell it
 * apart. Choosing it draws it on the map; the corrections open underneath it.
 */
export function RouteListItem({ row, selected, onSelect }: RouteListItemProps) {
  const tokens = useTokens();

  return (
    <li
      className={cn(
        "shrink-0 overflow-hidden rounded-xl border transition-colors",
        selected ? "bg-muted/60 border-foreground/25" : "hover:bg-muted/40 border-transparent",
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        className="flex w-full items-center gap-3 p-2 text-left"
      >
        <div className="bg-muted relative h-14 w-[72px] shrink-0 overflow-hidden rounded-lg">
          {row.polyline ? (
            <RoutePreview
              polyline={row.polyline}
              color={kindColor(tokens, row.kind)}
              width={THUMB_WIDTH}
              height={THUMB_HEIGHT}
            />
          ) : (
            <Map className="text-muted-foreground m-4 size-6" aria-hidden />
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-sm font-medium">{row.name}</span>
          <span className="text-muted-foreground flex items-center gap-x-1.5 text-xs whitespace-nowrap">
            <span className="tabular-nums">{row.attempts}×</span>
            <span aria-hidden>·</span>
            <span className="tabular-nums">{row.distance}</span>
            <span aria-hidden>·</span>
            <span className="tabular-nums">best {row.best}</span>
          </span>
        </div>
      </button>
      {selected && <RouteCardDetail row={row} />}
    </li>
  );
}
