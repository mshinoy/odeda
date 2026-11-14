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
import { blocks, intervals, zone2Ceiling } from "@/features/activity/intervals";
import { IntervalsPanel } from "@/features/activity/IntervalsPanel";
import { WorkoutPanel } from "@/features/activity/WorkoutPanel";
import { KilometresPanel } from "@/features/activity/KilometresPanel";
import { kilometres } from "@/features/activity/kilometres";
import { MetricToggle } from "@/features/activity/MetricToggle";
import { trackDuration } from "@/features/activity/playback";
import type { CameraMode } from "@/features/activity/flyover";
import { PlaybackControls } from "@/features/activity/PlaybackControls";
import { usePlayback } from "@/features/activity/usePlayback";
import { useActivityWeather } from "@/api/queries/useActivityWeather";
import { WindBadge } from "@/features/activity/WindBadge";
import { withHeadwind } from "@/features/activity/wind";
import { availableMetrics, type MetricKey } from "@/lib/metrics";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { mapProvider } from "@/map/basemap";
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
export function EnduranceActivity({ activity: recorded }: { activity: Activity }) {
  const weather = useActivityWeather(recorded.summary.id).data?.weather ?? null;
  // The streams gain a headwind column once the wind is known, so the map and the chart
  // can colour by it like any other metric.
  const activity = useMemo(
    () => ({
      ...recorded,
      streams: withHeadwind(recorded.streams, weather?.wind_kmh, weather?.wind_dir_deg),
    }),
    [recorded, weather],
  );
  const [colorBy, setColorBy] = useState<MetricKey>("pace");
  const metricOptions = availableMetrics(activity.streams);
  // The replay clock is the activity's own elapsed time, so the map and the charts agree.
  const durationS = trackDuration(activity.streams.elapsedS);
  const playback = usePlayback(durationS);
  const [cameraMode, setCameraMode] = useState<CameraMode>("map");
  const [satellite, setSatellite] = useState(false);
  // Picking a flyover starts the replay it flies along; going back to the map leaves it be.
  const chooseCamera = (mode: CameraMode) => {
    setCameraMode(mode);
    if (mode !== "map" && !playback.playing) playback.toggle();
  };
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
    () => intervals(activity.laps, activity.streams, ceiling, activity.plan),
    [activity.laps, activity.streams, ceiling, activity.plan],
  );
  const steps = useMemo(
    () =>
      reps.rows.length > 0 ? null : blocks(activity.laps, ceiling, activity.streams, activity.plan),
    [reps.rows.length, activity.laps, activity.streams, ceiling, activity.plan],
  );
  // An interval session shows its reps, any other workout its steps: one panel or none.
  const workoutPanel = (className?: string) =>
    reps.rows.length > 0 ? (
      <IntervalsPanel data={reps} ceiling={ceiling} className={className} />
    ) : steps ? (
      <WorkoutPanel data={steps} ceiling={ceiling} className={className} />
    ) : null;
  const hasReps = reps.rows.length > 0 || steps !== null;
  const workoutLabel = reps.rows.length > 0 ? "Intervals" : "Workout";
  // A workout opens on its own panel; the kilometres are one click away.
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
                    cameraMode={cameraMode}
                    satellite={satellite}
                  />
                </Suspense>
              ) : (
                <EmptyState message="Maps need WebGL. Turn on hardware acceleration in the browser." />
              )}
              {weather && <WindBadge weather={weather} />}
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
              <PlaybackControls
                playback={playback}
                durationS={durationS}
                cameraMode={cameraMode}
                onCameraMode={chooseCamera}
                satellite={mapProvider === "mapbox" ? satellite : null}
                onSatellite={setSatellite}
              />
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
                  {workoutLabel}
                </ToggleGroupItem>
                <ToggleGroupItem value="km" className="px-3 text-xs">
                  Kilometres
                </ToggleGroupItem>
              </ToggleGroup>
            )}
            {showReps ? workoutPanel("flex-1") : <KilometresPanel data={km} className="flex-1" />}
          </div>
        </div>
      )}

      {!activity.track && workoutPanel()}

      <AlongTheRun activity={activity} colorBy={colorBy} onColorBy={setColorBy} />
      <ActivityChips activity={activity} newBests={bests} weather={weather} />
    </>
  );
}
