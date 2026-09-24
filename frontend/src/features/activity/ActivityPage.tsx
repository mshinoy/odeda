import { lazy, Suspense, useState } from "react";
import { useParams } from "react-router-dom";
import { useActivity } from "@/api/queries/useActivity";
import { EmptyState } from "@/components/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { ActivityCharts } from "@/features/activity/ActivityCharts";
import { ActivityDetails } from "@/features/activity/ActivityDetails";
import { ActivityHeader } from "@/features/activity/ActivityHeader";
import { ActivityPageSkeleton } from "@/features/activity/ActivityPageSkeleton";
import { ActivityStats } from "@/features/activity/ActivityStats";
import { MetricToggle } from "@/features/activity/MetricToggle";
import { availableMetrics, type MetricKey } from "@/lib/metrics";
import { supportsWebGL } from "@/map/webgl";

// deck.gl and the map libraries are large; load them only when a page shows a map.
const ActivityMap = lazy(() =>
  import("@/features/activity/ActivityMap").then((m) => ({ default: m.ActivityMap })),
);

export function ActivityPage() {
  const { id = "" } = useParams();
  const { activity, isPending, error } = useActivity(id);
  const [colorBy, setColorBy] = useState<MetricKey>("pace");

  if (isPending) return <ActivityPageSkeleton />;
  if (error) return <EmptyState message={error.message} />;
  if (!activity) return <EmptyState message="Activity not found." />;

  const metricOptions = availableMetrics(activity.streams);

  return (
    <div className="flex flex-col gap-8">
      <ActivityHeader summary={activity.summary} />
      <ActivityStats summary={activity.summary} />

      {activity.track && (
        <section className="relative h-[420px] overflow-hidden rounded-xl border">
          {supportsWebGL() ? (
            <Suspense fallback={<Skeleton className="h-full w-full rounded-none" />}>
              <ActivityMap activity={activity} colorBy={colorBy} />
            </Suspense>
          ) : (
            <EmptyState message="Maps need WebGL. Turn on hardware acceleration in the browser." />
          )}
          <div className="absolute top-3 left-3">
            <MetricToggle options={metricOptions} value={colorBy} onChange={setColorBy} />
          </div>
        </section>
      )}

      <ActivityCharts activity={activity} />
      <ActivityDetails activity={activity} />
    </div>
  );
}
