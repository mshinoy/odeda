import { lazy, Suspense, useMemo, useState } from "react";
import type { Activity, ActivityGap } from "@/api/adapters";
import { useActivityGaps } from "@/api/queries/useGaps";
import { usePerformance } from "@/api/queries/usePerformance";
import { useConfig } from "@/api/queries/useSettings";
import { EmptyState } from "@/components/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { ActivityChips } from "@/features/activity/ActivityChips";
import { ActivityStats } from "@/features/activity/ActivityStats";
import { AlongTheRun } from "@/features/activity/AlongTheRun";
import { AnswerRow } from "@/features/activity/AnswerRow";
import { newBests } from "@/features/activity/answers";
import { GapNotes } from "@/features/activity/GapNote";
import { intervals, zone2Ceiling } from "@/features/activity/intervals";
import { IntervalsPanel } from "@/features/activity/IntervalsPanel";
import { KilometresPanel } from "@/features/activity/KilometresPanel";
import { kilometres } from "@/features/activity/kilometres";
import { MetricToggle } from "@/features/activity/MetricToggle";
import { trackDuration } from "@/features/activity/playback";
import { PlaybackControls } from "@/features/activity/PlaybackControls";
import { usePlayback } from "@/features/activity/usePlayback";
import { availableMetrics, type MetricKey } from "@/lib/metrics";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { supportsWebGL } from "@/map/webgl";

// deck.gl and the map libraries are large; load them only when a page shows a map.
const ActivityMap = lazy(() =>
  import("@/features/activity/ActivityMap").then((m) => ({ default: m.ActivityMap })),
);

const NO_GAPS: readonly ActivityGap[] = [];

/**
 * Anything you cover ground in. The answers come first (the plan, the route, the effort),
 * then the map beside the kilometres, then the whole activity as one line, and the detail
 * behind chips. One control, the metric, colours the map and draws the chart.
 */
export function EnduranceActivity({ activity }: { activity: Activity }) {
  const [colorBy, setColorBy] = useState<MetricKey>("pace");
  const metricOptions = availableMetrics(activity.streams);
  // The replay clock is the activity's own elapsed time, so the map and the charts agree.
  const durationS = trackDuration(activity.streams.elapsedS);
  const playback = usePlayback(durationS);
  const gaps = useActivityGaps(activity.summary.id, activity.track !== null).data ?? NO_GAPS;
  const performance = usePerformance();
  const bests = useMemo(
    () => newBests(performance.data, activity.summary.id),
    [performance.data, activity.summary.id],
  );
  const km = useMemo(
    () => kilometres(activity.splits, activity.summary.kind),
    [activity.splits, activity.summary.kind],
  );
  const athlete = useConfig().data?.athlete;
  const ceiling = zone2Ceiling(athlete?.hr_rest, athlete?.hr_max);
  const reps = useMemo(
    () => intervals(activity.laps, activity.streams, ceiling),
    [activity.laps, activity.streams, ceiling],
  );
  const hasReps = reps.rows.length > 0;
  // A workout opens on its intervals; the kilometres are one click away.
  const [side, setSide] = useState<"intervals" | "km">("intervals");
  const showReps = hasReps && (side === "intervals" || km.rows.length === 0);

  return (
    <>
      <ActivityStats summary={activity.summary} />
      <AnswerRow activity={activity} />

      {activity.track && (
        <div className="grid items-stretch gap-5 lg:grid-cols-[minmax(0,1fr)_24rem]">
          <div className="flex min-w-0 flex-col gap-3">
            <section className="shadow-card relative h-[34rem] overflow-hidden rounded-2xl border">
              {supportsWebGL() ? (
                <Suspense fallback={<Skeleton className="h-full w-full rounded-none" />}>
                  <ActivityMap
                    activity={activity}
                    colorBy={colorBy}
                    playback={playback}
                    gaps={gaps}
                  />
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
            <GapNotes gaps={gaps} kind={activity.summary.kind} />
          </div>
          <div className="flex min-h-0 flex-col gap-2 lg:max-h-[38rem]">
            {hasReps && km.rows.length > 0 && (
              <ToggleGroup
                type="single"
                size="sm"
                value={side}
                onValueChange={(next) => {
                  if (next === "intervals" || next === "km") setSide(next);
                }}
                className="bg-muted self-start rounded-lg p-0.5"
              >
                <ToggleGroupItem value="intervals" className="px-3 text-xs">
                  Intervals
                </ToggleGroupItem>
                <ToggleGroupItem value="km" className="px-3 text-xs">
                  Kilometres
                </ToggleGroupItem>
              </ToggleGroup>
            )}
            {showReps ? (
              <IntervalsPanel data={reps} ceiling={ceiling} className="flex-1" />
            ) : (
              <KilometresPanel data={km} className="flex-1" />
            )}
          </div>
        </div>
      )}

      {!activity.track && hasReps && <IntervalsPanel data={reps} ceiling={ceiling} />}

      <AlongTheRun activity={activity} colorBy={colorBy} onColorBy={setColorBy} />
      <ActivityChips activity={activity} newBests={bests} />
    </>
  );
}
