import { useMemo, useState } from "react";
import { useMergeRoutes } from "@/api/queries/useEditRoute";
import { useRouteList } from "@/api/queries/useRoutes";
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
import { Skeleton } from "@/components/ui/skeleton";
import { PickList } from "@/features/routes/PickList";
import { mergeOptions, pickLabel, toggle } from "@/features/routes/routePicks";

interface MergeRoutesDialogProps {
  routeId: number;
  activityType: string;
}

/** Folds routes the clusterer split by mistake into this one. */
export function MergeRoutesDialog({ routeId, activityType }: MergeRoutesDialogProps) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const routes = useRouteList();
  const merge = useMergeRoutes(routeId);

  const options = useMemo(
    () => (routes.data ? mergeOptions(routes.data, { id: routeId, activityType }) : []),
    [routes.data, routeId, activityType],
  );

  function change(next: boolean) {
    setOpen(next);
    if (!next) setSelected(new Set());
  }

  function submit() {
    merge.mutate([...selected].map(Number), { onSuccess: () => change(false) });
  }

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Merge
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Merge into this route</DialogTitle>
          <DialogDescription>
            The routes you pick stop existing; their attempts move here.
          </DialogDescription>
        </DialogHeader>
        {routes.data ? (
          <PickList
            options={options}
            selected={selected}
            onToggle={(id) => setSelected((current) => toggle(current, id))}
            emptyMessage="No other route of this type to merge."
          />
        ) : (
          <Skeleton className="h-40 w-full" />
        )}
        <DialogFooter className="items-center">
          {merge.error && <p className="text-delta-bad mr-auto text-sm">{merge.error.message}</p>}
          <Button onClick={submit} disabled={selected.size === 0 || merge.isPending}>
            {pickLabel("Merge", selected.size)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
