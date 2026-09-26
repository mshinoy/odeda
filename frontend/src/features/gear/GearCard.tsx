import type { GearRecord } from "@/api/adapters";
import { Button } from "@/components/ui/button";
import { StatusDot } from "@/components/StatusDot";
import { WearBar } from "@/features/gear/WearBar";
import { wearLabel, wearOf, wearTone } from "@/features/gear/gearView";
import { formatDate, formatDistance, formatInteger, formatPercent } from "@/lib/format";

interface GearCardProps {
  item: GearRecord;
  isDefaultFor: readonly string[];
  onEdit: () => void;
  onAssign: () => void;
}

/** One item: what it is, how far it has gone, and how close it is to being done. */
export function GearCard({ item, isDefaultFor, onEdit, onAssign }: GearCardProps) {
  const wear = wearOf(item);

  return (
    <article className="flex flex-col gap-3 rounded-lg border p-4">
      <header className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h3 className="font-medium">{item.name}</h3>
          <p className="text-muted-foreground text-xs capitalize">{item.kind}</p>
        </div>
        <span className="text-stat leading-none font-semibold tracking-tight tabular-nums">
          {formatDistance(item.totalDistanceM)}
        </span>
      </header>

      <WearBar wear={wear} />

      <p className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <StatusDot tone={wearTone[item.state]} label={wearLabel[item.state]} />
        {wear.pct !== null && (
          <span>
            {formatPercent(wear.pct)} of {formatDistance(item.retirementDistanceM)}
          </span>
        )}
        <span>{formatInteger(item.activityCount)} activities</span>
        {item.lastUse && <span>last {formatDate(item.lastUse)}</span>}
      </p>

      {isDefaultFor.length > 0 && (
        <p className="text-muted-foreground text-xs">Default for {isDefaultFor.join(", ")}</p>
      )}

      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={onEdit}>
          Edit
        </Button>
        <Button variant="ghost" size="sm" onClick={onAssign}>
          Assign to a range
        </Button>
      </div>
    </article>
  );
}
