import { useMemo, useState } from "react";
import type { RouteAttempt } from "@/api/adapters";
import { useSplitRoute } from "@/api/queries/useEditRoute";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { PickList } from "@/features/routes/PickList";
import { pickLabel, splitBlockedReason, splitOptions, toggle } from "@/features/routes/routePicks";

interface SplitRouteDialogProps {
  routeId: number;
  attempts: readonly RouteAttempt[];
}

/** Pulls attempts the clusterer filed here by mistake out into a route of their own. */
export function SplitRouteDialog({ routeId, attempts }: SplitRouteDialogProps) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [name, setName] = useState("");
  const split = useSplitRoute(routeId);

  const options = useMemo(() => splitOptions(attempts), [attempts]);
  const blocked = splitBlockedReason(selected.size, attempts.length);

  function change(next: boolean) {
    setOpen(next);
    if (!next) {
      setSelected(new Set());
      setName("");
    }
  }

  function submit() {
    split.mutate({ activityIds: [...selected], name }, { onSuccess: () => change(false) });
  }

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Split
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Split out of this route</DialogTitle>
          <DialogDescription>
            The attempts you pick move to a new route of their own.
          </DialogDescription>
        </DialogHeader>
        <PickList
          options={options}
          selected={selected}
          onToggle={(id) => setSelected((current) => toggle(current, id))}
          emptyMessage="This route has no attempts to split."
        />
        <Input
          aria-label="New route name"
          placeholder="New route name (optional)"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <DialogFooter className="items-center">
          {(blocked ?? split.error) && (
            <p className="text-delta-bad mr-auto text-sm">{blocked ?? split.error?.message}</p>
          )}
          <Button
            onClick={submit}
            disabled={selected.size === 0 || blocked !== null || split.isPending}
          >
            {pickLabel("Split", selected.size)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
