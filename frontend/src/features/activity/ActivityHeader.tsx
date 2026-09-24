import type { ReactNode } from "react";
import { Pencil, Route as RouteIcon, Tag } from "lucide-react";
import type { ActivityRoute, ActivitySummary, FieldEdit, GearItem } from "@/api/adapters";
import { KindBadge } from "@/components/KindBadge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { activityTypeLabel } from "@/lib/activityKind";
import { formatDateTime } from "@/lib/format";

interface ActivityHeaderProps {
  summary: ActivitySummary;
  /** The fields the user has edited; the header says so when there are any. */
  edits: readonly FieldEdit[];
  /** The gear worn and the route it is filed under; each shown only when set. */
  gear: readonly GearItem[];
  route: ActivityRoute | null;
  /** Buttons on the right, e.g. Edit. */
  actions?: ReactNode;
}

export function ActivityHeader({ summary, edits, gear, route, actions }: ActivityHeaderProps) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">{summary.name}</h1>
        <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <span>{formatDateTime(summary.startLocal)}</span>
          <KindBadge kind={summary.kind} label={activityTypeLabel(summary.type)} />
          {gear.length > 0 && (
            <Mark icon={<Tag className="size-3" aria-hidden />}>
              {gear.map((item) => item.name).join(", ")}
            </Mark>
          )}
          {route && <Mark icon={<RouteIcon className="size-3" aria-hidden />}>{route.name}</Mark>}
          {edits.length > 0 && <EditedMark edits={edits} />}
        </div>
      </div>
      {actions}
    </div>
  );
}

/** One icon-and-text item of the header's meta row. */
function Mark({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1">
      {icon}
      <span className="truncate">{children}</span>
    </span>
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
