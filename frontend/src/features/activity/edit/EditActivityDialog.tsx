import { Pencil } from "lucide-react";
import { useState } from "react";
import { toFieldEdits } from "@/api/adapters";
import { useActivityDetail } from "@/api/queries/useActivity";
import { useEditableFields } from "@/api/queries/useEditActivity";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { EditActivityForm } from "@/features/activity/edit/EditActivityForm";

const SKELETON_FIELDS = [0, 1, 2, 3];

/** The page's Edit button and the dialog it opens. */
export function EditActivityDialog({ activityId }: { activityId: string }) {
  const [open, setOpen] = useState(false);
  const fields = useEditableFields();
  // Already cached by the page; this reads the same query.
  const detail = useActivityDetail(activityId);
  const row = detail.data?.activity;
  const edits = detail.data ? toFieldEdits(detail.data.overrides) : [];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Pencil />
          Edit
        </Button>
      </DialogTrigger>
      <DialogContent aria-describedby={undefined} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit activity</DialogTitle>
        </DialogHeader>
        {fields.error && <EmptyState message={fields.error.message} />}
        {!fields.error && fields.data && row ? (
          <EditActivityForm
            row={row}
            fields={fields.data}
            edits={edits}
            onSaved={() => setOpen(false)}
          />
        ) : (
          !fields.error &&
          SKELETON_FIELDS.map((key) => <Skeleton key={key} className="h-12 w-full" />)
        )}
      </DialogContent>
    </Dialog>
  );
}
