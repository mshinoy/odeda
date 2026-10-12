import { useMemo, useState } from "react";
import { useMergeRoutes } from "@/api/queries/useEditRoute";
import { useRouteSimilar } from "@/api/queries/useRoute";
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
import { MergeCandidate } from "@/features/routes/MergeCandidate";
import { mergeCandidates, pickLabel, toggle } from "@/features/routes/routePicks";

interface MergeRoutesDialogProps {
  routeId: number;
  activityType: string;
}

/** Folds routes the clusterer split by mistake into this one. */
export function MergeRoutesDialog({ routeId, activityType }: MergeRoutesDialogProps) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const routes = useRouteList();
  const similar = useRouteSimilar(routeId, open);
  const merge = useMergeRoutes(routeId);

  const options = useMemo(
    () =>
      routes.data && similar.data
        ? mergeCandidates(routes.data, similar.data.candidates, {
            id: routeId,
            activityType,
          })
        : [],
    [routes.data, similar.data, routeId, activityType],
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
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Merge into this route</DialogTitle>
          <DialogDescription>
            Most alike first, then nearest. The routes you pick stop existing; their attempts move
            here.
          </DialogDescription>
        </DialogHeader>
        {routes.data && similar.data ? (
          options.length === 0 ? (
            <p className="text-muted-foreground py-6 text-center text-sm">
              No other route of this type to merge.
            </p>
          ) : (
            <div className="flex max-h-[22rem] flex-col gap-2 overflow-y-auto pr-1">
              {options.map((option) => (
                <MergeCandidate
                  key={option.route.id}
                  route={option.route}
                  similarity={option.similarity}
                  metresAway={option.metresAway}
                  selected={selected.has(String(option.route.id))}
                  onToggle={() =>
                    setSelected((current) => toggle(current, String(option.route.id)))
                  }
                />
              ))}
            </div>
          )
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
