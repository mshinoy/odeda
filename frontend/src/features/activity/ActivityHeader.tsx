import type { ActivitySummary } from "@/api/adapters";
import { KindBadge } from "@/components/KindBadge";
import { activityTypeLabel } from "@/lib/activityKind";
import { formatDateTime } from "@/lib/format";

export function ActivityHeader({ summary }: { summary: ActivitySummary }) {
  return (
    <div className="flex flex-col gap-1">
      <h1 className="text-xl font-semibold tracking-tight">{summary.name}</h1>
      <div className="text-muted-foreground flex items-center gap-3 text-sm">
        <span>{formatDateTime(summary.startLocal)}</span>
        <KindBadge kind={summary.kind} label={activityTypeLabel(summary.type)} />
      </div>
    </div>
  );
}
