import { usePerformance } from "@/api/queries/usePerformance";
import { EmptyState } from "@/components/EmptyState";
import { PerformancePanel } from "@/features/trends/PerformancePanel";
import { TrendsPageSkeleton } from "@/features/trends/TrendsPageSkeleton";

/** How your running has changed over the years you have recorded. */
export function TrendsPage() {
  const performance = usePerformance();

  if (performance.isPending) return <TrendsPageSkeleton />;
  if (performance.error) return <EmptyState message={performance.error.message} />;

  return (
    <div className="flex flex-col gap-12">
      <PerformancePanel performance={performance.data} />
    </div>
  );
}
