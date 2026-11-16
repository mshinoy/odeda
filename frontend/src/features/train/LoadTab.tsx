import { useSummary, useTrainingLoad } from "@/api/queries/useStatus";
import { EmptyState } from "@/components/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { GymPanel } from "@/features/status/GymPanel";
import { LoadPanel } from "@/features/status/LoadPanel";

/** Training load, and gym sessions: what Today used to keep one toggle down. */
export function LoadTab() {
  const load = useTrainingLoad();
  const summary = useSummary();

  if (load.isPending || summary.isPending) return <Skeleton className="h-96 w-full rounded-2xl" />;
  if (load.error) return <EmptyState message={load.error.message} />;
  if (summary.error) return <EmptyState message={summary.error.message} />;

  return (
    <div className="flex flex-col gap-6">
      <LoadPanel load={load.data} />
      {summary.data.gym && <GymPanel gym={summary.data.gym} />}
    </div>
  );
}
