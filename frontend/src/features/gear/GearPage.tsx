import { useMemo, useState } from "react";
import type { GearRecord } from "@/api/adapters";
import { useGearCollection } from "@/api/queries/useGear";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { BulkAssignDialog } from "@/features/gear/BulkAssignDialog";
import { DefaultsPanel } from "@/features/gear/DefaultsPanel";
import { GearCard } from "@/features/gear/GearCard";
import { GearDialog } from "@/features/gear/GearDialog";
import { visibleGear } from "@/features/gear/gearView";

/** Your shoes and bikes: how far each has gone, and what it was worn for. */
export function GearPage() {
  const collection = useGearCollection();
  const [showRetired, setShowRetired] = useState(false);
  const [editing, setEditing] = useState<GearRecord | null>(null);
  const [adding, setAdding] = useState(false);
  const [assigning, setAssigning] = useState<GearRecord | null>(null);

  const gear = useMemo(() => collection.data?.gear ?? [], [collection.data]);
  const cards = useMemo(() => visibleGear(gear, showRetired), [gear, showRetired]);
  const defaultsByGear = useMemo(() => {
    const map = new Map<number, string[]>();
    for (const rule of collection.data?.defaults ?? []) {
      map.set(rule.gearId, [...(map.get(rule.gearId) ?? []), rule.activityType]);
    }
    return map;
  }, [collection.data]);

  const retiredCount = gear.filter((item) => item.retired).length;

  if (collection.isPending) return <Skeleton className="h-64 w-full rounded-2xl" />;
  if (collection.error) return <EmptyState message={collection.error.message} />;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-4">
        {/* With no gear at all the empty state already asks for the first item;
            two "Add gear" buttons on one screen is one too many. */}
        {gear.length > 0 && (
          <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
            Add gear
          </Button>
        )}
        {retiredCount > 0 && (
          <label className="text-muted-foreground flex items-center gap-2 text-sm">
            <Switch checked={showRetired} onCheckedChange={setShowRetired} />
            Show retired ({retiredCount})
          </label>
        )}
      </div>

      {cards.length === 0 ? (
        <EmptyState
          message={
            gear.length === 0
              ? "No gear yet. Add a pair of shoes and its mileage starts counting."
              : "Every item is retired."
          }
          action={
            gear.length === 0 ? (
              <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
                Add gear
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={() => setShowRetired(true)}>
                Show retired
              </Button>
            )
          }
        />
      ) : (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((item) => (
            <GearCard
              key={item.id}
              item={item}
              isDefaultFor={defaultsByGear.get(item.id) ?? []}
              onEdit={() => setEditing(item)}
              onAssign={() => setAssigning(item)}
            />
          ))}
        </div>
      )}

      {collection.data && <DefaultsPanel collection={collection.data} />}

      {/* Keyed, so the dialog's draft starts from the item that was opened. */}
      {adding && (
        <GearDialog
          key="add"
          item={null}
          kinds={collection.data?.kinds ?? []}
          open
          onOpenChange={setAdding}
        />
      )}
      {editing && (
        <GearDialog
          key={editing.id}
          item={editing}
          kinds={collection.data?.kinds ?? []}
          open
          onOpenChange={(open) => !open && setEditing(null)}
        />
      )}
      {assigning && (
        <BulkAssignDialog
          key={assigning.id}
          item={assigning}
          open
          onOpenChange={(open) => !open && setAssigning(null)}
        />
      )}
    </div>
  );
}
