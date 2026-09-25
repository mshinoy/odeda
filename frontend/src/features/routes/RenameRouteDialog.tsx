import { useState, type FormEvent } from "react";
import { useRenameRoute } from "@/api/queries/useEditRoute";
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

interface RenameRouteDialogProps {
  routeId: number;
  currentName: string;
}

export function RenameRouteDialog({ routeId, currentName }: RenameRouteDialogProps) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Rename
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Rename route</DialogTitle>
          <DialogDescription>
            Naming a route pins it, so reclustering leaves it alone.
          </DialogDescription>
        </DialogHeader>
        {/* Remounted with the dialog, so it always opens on the saved name. */}
        {open && (
          <RenameForm routeId={routeId} currentName={currentName} onDone={() => setOpen(false)} />
        )}
      </DialogContent>
    </Dialog>
  );
}

interface RenameFormProps {
  routeId: number;
  currentName: string;
  onDone: () => void;
}

function RenameForm({ routeId, currentName, onDone }: RenameFormProps) {
  const [name, setName] = useState(currentName);
  const rename = useRenameRoute(routeId);
  const trimmed = name.trim();
  const canSave = trimmed !== "" && trimmed !== currentName && !rename.isPending;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!canSave) return;
    rename.mutate(trimmed, { onSuccess: onDone });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Input
        aria-label="Route name"
        value={name}
        autoFocus
        onChange={(event) => setName(event.target.value)}
      />
      <DialogFooter className="items-center">
        {rename.error && <p className="text-delta-bad mr-auto text-sm">{rename.error.message}</p>}
        <Button type="submit" disabled={!canSave}>
          Save
        </Button>
      </DialogFooter>
    </form>
  );
}
