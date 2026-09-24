import type { ReactNode } from "react";
import type { ActivitySummary } from "@/api/adapters";
import { KindBadge } from "@/components/KindBadge";
import { activityTypeLabel } from "@/lib/activityKind";
import { formatDateTime } from "@/lib/format";

interface ActivityHeaderProps {
  summary: ActivitySummary;
  /** Buttons on the right, e.g. Edit. */
  actions?: ReactNode;
}

export function ActivityHeader({ summary, actions }: ActivityHeaderProps) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">{summary.name}</h1>
        <div className="text-muted-foreground flex items-center gap-3 text-sm">
          <span>{formatDateTime(summary.startLocal)}</span>
          <KindBadge kind={summary.kind} label={activityTypeLabel(summary.type)} />
        </div>
      </div>
      {actions}
    </div>
  );
}
