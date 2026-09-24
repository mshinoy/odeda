import type { ReactNode } from "react";
import { Pencil } from "lucide-react";
import type { ActivitySummary, FieldEdit } from "@/api/adapters";
import { KindBadge } from "@/components/KindBadge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { activityTypeLabel } from "@/lib/activityKind";
import { formatDateTime } from "@/lib/format";

interface ActivityHeaderProps {
  summary: ActivitySummary;
  /** The fields the user has edited; the header says so when there are any. */
  edits: readonly FieldEdit[];
  /** Buttons on the right, e.g. Edit. */
  actions?: ReactNode;
}

export function ActivityHeader({ summary, edits, actions }: ActivityHeaderProps) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">{summary.name}</h1>
        <div className="text-muted-foreground flex items-center gap-3 text-sm">
          <span>{formatDateTime(summary.startLocal)}</span>
          <KindBadge kind={summary.kind} label={activityTypeLabel(summary.type)} />
          {edits.length > 0 && <EditedMark edits={edits} />}
        </div>
      </div>
      {actions}
    </div>
  );
}

/** "Edited", with the edited fields on hover. */
function EditedMark({ edits }: { edits: readonly FieldEdit[] }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          className="inline-flex items-center gap-1 rounded-sm outline-none focus-visible:ring-2"
        >
          <Pencil className="size-3" aria-hidden />
          Edited
        </span>
      </TooltipTrigger>
      <TooltipContent>{edits.map((edit) => edit.label).join(", ")}</TooltipContent>
    </Tooltip>
  );
}
