import { lazy, Suspense, useState } from "react";
import type { Activity } from "@/api/adapters";
import { EmptyState } from "@/components/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { ActivityCharts } from "@/features/activity/ActivityCharts";
import { ActivityDetails } from "@/features/activity/ActivityDetails";
import { ActivityStats } from "@/features/activity/ActivityStats";
import { MetricToggle } from "@/features/activity/MetricToggle";
import { trackDuration } from "@/features/activity/playback";
import { PlaybackControls } from "@/features/activity/PlaybackControls";
import { usePlayback } from "@/features/activity/usePlayback";
import { availableMetrics, type MetricKey } from "@/lib/metrics";
import { supportsWebGL } from "@/map/webgl";

// deck.gl and the map libraries are large; load them only when a page shows a map.
const ActivityMap = lazy(() =>
  import("@/features/activity/ActivityMap").then((m) => ({ default: m.ActivityMap })),
);

/** Anything you cover ground in: the map is the hero, with the streams under it. */
export function EnduranceActivity({ activity }: { activity: Activity }) {
  const [colorBy, setColorBy] = useState<MetricKey>("pace");
  const metricOptions = availableMetrics(activity.streams);
  // The replay clock is the activity's own elapsed time, so the map and the charts agree.
  const durationS = trackDuration(activity.streams.elapsedS);
  const playback = usePlayback(durationS);

  return (
    <>
      <ActivityStats summary={activity.summary} />

      {activity.track && (
        <div className="flex flex-col gap-3">
          <section className="relative h-[420px] overflow-hidden rounded-xl border">
            {supportsWebGL() ? (
              <Suspense fallback={<Skeleton className="h-full w-full rounded-none" />}>
                <ActivityMap activity={activity} colorBy={colorBy} playback={playback} />
              </Suspense>
            ) : (
              <EmptyState message="Maps need WebGL. Turn on hardware acceleration in the browser." />
            )}
            <div className="absolute top-3 left-3">
              <MetricToggle
                options={metricOptions}
                value={colorBy}
                kind={activity.summary.kind}
                onChange={setColorBy}
              />
            </div>
          </section>
          {supportsWebGL() && durationS > 0 && (
            <PlaybackControls playback={playback} durationS={durationS} />
          )}
        </div>
      )}

      <ActivityCharts activity={activity} />
      <ActivityDetails activity={activity} />
    </>
  );
}
