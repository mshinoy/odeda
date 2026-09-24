import { useMemo, useState } from "react";
import type { Activity } from "@/api/adapters";
import { useExercises } from "@/api/queries/useExercises";
import { EmptyState } from "@/components/EmptyState";
import { StatCard } from "@/components/StatCard";
import { Skeleton } from "@/components/ui/skeleton";
import { ActivityCharts } from "@/features/activity/ActivityCharts";
import { ActivityDetails } from "@/features/activity/ActivityDetails";
import { BodyDiagram } from "@/features/activity/gym/BodyDiagram";
import { ExerciseTable } from "@/features/activity/gym/ExerciseTable";
import {
  exerciseRows,
  highlightedMuscles,
  highlightedRows,
  sessionTotals,
  totalVolumeG,
  type GymHover,
} from "@/features/activity/gym/gymSession";
import {
  formatDuration,
  formatHeartRate,
  formatInteger,
  formatVolume,
  MISSING,
} from "@/lib/format";
import { MUSCLE_LABELS, maxMuscleLoad, muscleLoad } from "@/lib/muscles";

const DIAGRAM_HEIGHT = "h-[360px]";

/**
 * A gym session's page. The body diagram is the hero here, as the map is for a run:
 * what a session is *for* is which muscles it worked, and Garmin sends no muscle data,
 * so it is derived from the exercises (`lib/muscles.ts`). No map — there is nowhere
 * to draw.
 */
export function GymActivity({ activity }: { activity: Activity }) {
  const exercises = useExercises(activity.summary.id);
  const [hover, setHover] = useState<GymHover>(null);

  const session = exercises.data;
  const rows = useMemo(() => exerciseRows(session?.exercises ?? []), [session]);
  const load = useMemo(() => muscleLoad(session?.exercises ?? []), [session]);
  const maxLoad = maxMuscleLoad(load);
  const muscles = highlightedMuscles(rows, hover);
  const marked = highlightedRows(rows, hover);
  const totals = session ? sessionTotals(session) : { sets: null, reps: null };
  const volume = session ? totalVolumeG(session.exercises) : null;

  return (
    <>
      <div className="grid grid-cols-2 gap-x-8 gap-y-6 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard label="Duration" value={formatDuration(activity.summary.durationS)} />
        <StatCard label="Sets" value={formatInteger(totals.sets)} />
        <StatCard label="Reps" value={formatInteger(totals.reps)} />
        <StatCard label="Volume" value={volume === null ? MISSING : formatVolume(volume)} />
        <StatCard label="Avg HR" value={formatHeartRate(activity.summary.avgHr)} />
      </div>

      {exercises.error && <EmptyState message={exercises.error.message} />}
      {!exercises.error && session === undefined && (
        <Skeleton className={`${DIAGRAM_HEIGHT} w-full rounded-xl`} />
      )}
      {session && rows.length === 0 && (
        <EmptyState message="Garmin recorded no exercises for this session." />
      )}
      {session && rows.length > 0 && (
        // Side by side, so pointing at a row and watching the body light up needs no
        // scrolling — and a figure has nothing to do with the width a map wants.
        <div className="grid gap-8 lg:grid-cols-[minmax(0,380px)_1fr] lg:items-start">
          <section
            aria-label="Muscles trained"
            className="flex flex-col gap-3 rounded-xl border px-4 py-4"
          >
            <p className="text-muted-foreground text-sm">
              {hover?.on === "muscle" ? MUSCLE_LABELS[hover.muscle] : "Muscles trained"}
            </p>
            <BodyDiagram
              load={load}
              maxLoad={maxLoad}
              highlighted={muscles}
              onHover={(muscle) => setHover(muscle === null ? null : { on: "muscle", muscle })}
            />
          </section>

          <section aria-label="Exercises">
            <ExerciseTable
              rows={rows}
              highlighted={marked}
              onHover={(index) => setHover(index === null ? null : { on: "exercise", index })}
            />
          </section>
        </div>
      )}

      <ActivityCharts activity={activity} />
      <ActivityDetails activity={activity} />
    </>
  );
}
