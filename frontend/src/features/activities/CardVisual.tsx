import { Activity, Bike, Dumbbell, Footprints, Waves, type LucideIcon } from "lucide-react";
import type { HrZoneTime } from "@/api/adapters";
import { Skeleton } from "@/components/ui/skeleton";
import { zoneName, zoneShares } from "@/charts/hrZones/buildHrZonesOption";
import { hrZoneColor, kindColor } from "@/design/scales";
import { useTokens } from "@/design/theme";
import { BodyFigure } from "@/features/activity/gym/BodyDiagram";
import { BODY_VIEWS } from "@/features/activity/gym/bodyPaths";
import type { CardVisual as Visual } from "@/features/activities/cardView";
import type { ActivityKind } from "@/lib/activityKind";
import { formatDuration } from "@/lib/format";
import { RoutePreview } from "@/map/RoutePreview";

/** The picture's size on a wide screen, in CSS pixels; it fills the card's width below. */
export const VISUAL_WIDTH = 240;
export const VISUAL_HEIGHT = 180;

interface CardVisualProps {
  visual: Visual;
  kind: ActivityKind;
  /** The route for a map: undefined while it is on its way, null if none came. */
  polyline: string | null | undefined;
}

/** The left of an activity card: the route, the muscles worked, the HR zones, or the sport. */
export function CardVisual({ visual, kind, polyline }: CardVisualProps) {
  const tokens = useTokens();
  switch (visual.kind) {
    case "map":
      if (polyline === undefined) return <Skeleton className="h-full w-full rounded-none" />;
      if (polyline === null) return <KindIcon kind={kind} />;
      return (
        <RoutePreview
          polyline={polyline}
          color={kindColor(tokens, kind)}
          width={VISUAL_WIDTH}
          height={VISUAL_HEIGHT}
        />
      );
    case "body":
      return (
        <div className="flex h-full items-center justify-center gap-3 py-3">
          {BODY_VIEWS.map((view) => (
            <BodyFigure
              key={view}
              view={view}
              load={visual.load}
              maxLoad={visual.maxLoad}
              className="h-full w-auto"
            />
          ))}
        </div>
      );
    case "zones":
      return <ZoneBars zones={visual.zones} />;
    case "none":
      return <KindIcon kind={kind} />;
  }
}

/** Time in each zone with time in it, Z1 at the top, bars as long as their share. */
function ZoneBars({ zones }: { zones: readonly HrZoneTime[] }) {
  const tokens = useTokens();
  const shares = zoneShares(zones);
  const longest = Math.max(...shares.map((share) => share.share));
  return (
    <ul className="flex h-full flex-col justify-center gap-1.5 px-4" aria-label="Time in HR zones">
      {shares.map((share) => (
        <li key={share.zone} className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground w-5">{zoneName(share.zone)}</span>
          <span className="flex-1">
            <span
              className="block h-2.5 rounded-sm"
              style={{
                width: `${(share.share / longest) * 100}%`,
                backgroundColor: hrZoneColor(tokens, share.zone),
              }}
            />
          </span>
          <span className="text-muted-foreground w-12 text-right tabular-nums">
            {formatDuration(share.seconds)}
          </span>
        </li>
      ))}
    </ul>
  );
}

const KIND_ICON: Record<ActivityKind, LucideIcon> = {
  run: Footprints,
  walk: Footprints,
  ride: Bike,
  swim: Waves,
  strength: Dumbbell,
  other: Activity,
};

function KindIcon({ kind }: { kind: ActivityKind }) {
  const tokens = useTokens();
  const Icon = KIND_ICON[kind];
  return (
    <div className="flex h-full items-center justify-center">
      <Icon className="size-10" style={{ color: kindColor(tokens, kind) }} aria-hidden />
    </div>
  );
}
