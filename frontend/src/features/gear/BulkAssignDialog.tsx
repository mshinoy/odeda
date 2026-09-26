import { useState } from "react";
import type { GearRecord } from "@/api/adapters";
import { useActivityTypes } from "@/api/queries/useActivityTypes";
import { useBulkAssignGear, type BulkAssign } from "@/api/queries/useGear";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/NativeSelect";
import { Switch } from "@/components/ui/switch";
import { formatInteger } from "@/lib/format";

interface BulkAssignDialogProps {
  item: GearRecord;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Put one item on every activity in a range: "every run that spring was the
 * Novablasts". Assigning replaces whatever gear of the same kind was there, so this
 * is also how a wrong pair of shoes is corrected across a stretch of history.
 *
 * Nothing is applied until the preview has been seen. The preview is the backend's
 * own `dry_run`, so the count is the same query the apply will run, not a guess.
 */
export function BulkAssignDialog({ item, open, onOpenChange }: BulkAssignDialogProps) {
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [activityType, setActivityType] = useState("");
  const [onlyUnassigned, setOnlyUnassigned] = useState(false);
  const [matched, setMatched] = useState<number | null>(null);
  const types = useActivityTypes();
  const bulk = useBulkAssignGear(item.id);

  function filters(dryRun: boolean): BulkAssign {
    return {
      start: start || null,
      end: end || null,
      activity_type: activityType || null,
      only_unassigned: onlyUnassigned,
      dry_run: dryRun,
    };
  }

  function preview() {
    bulk.mutate(filters(true), { onSuccess: (result) => setMatched(result.matched) });
  }

  function apply() {
    bulk.mutate(filters(false), {
      onSuccess: () => {
        setMatched(null);
        onOpenChange(false);
      },
    });
  }

  // Any change to the filters invalidates the count the preview produced.
  function changed<T>(set: (value: T) => void) {
    return (value: T) => {
      setMatched(null);
      set(value);
    };
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Assign {item.name} to a range</DialogTitle>
          <DialogDescription>
            Every matching activity gets it, replacing whatever {item.kind} was on it.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="bulk-start">From</Label>
              <Input
                id="bulk-start"
                type="date"
                value={start}
                onChange={(event) => changed(setStart)(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="bulk-end">To</Label>
              <Input
                id="bulk-end"
                type="date"
                value={end}
                onChange={(event) => changed(setEnd)(event.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="bulk-type">Activity type</Label>
            <NativeSelect
              id="bulk-type"
              value={activityType}
              onChange={(event) => changed(setActivityType)(event.target.value)}
            >
              <option value="">Every type</option>
              {(types.data ?? []).map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </NativeSelect>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <Switch
              checked={onlyUnassigned}
              onCheckedChange={(next) => changed(setOnlyUnassigned)(next)}
            />
            Only activities with no {item.kind} yet
          </label>

          {matched !== null && (
            <p className="text-sm">
              {matched === 0
                ? "Nothing matches that filter."
                : `${formatInteger(matched)} activities match. Nothing has changed yet.`}
            </p>
          )}
          {bulk.error && <p className="text-delta-bad text-sm">{bulk.error.message}</p>}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="outline" disabled={bulk.isPending} onClick={preview}>
            Preview
          </Button>
          <Button disabled={bulk.isPending || matched === null || matched === 0} onClick={apply}>
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
