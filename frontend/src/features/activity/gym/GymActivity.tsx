import { useMemo, useState } from "react";
import type { Activity } from "@/api/adapters";
import { useActivityPlan } from "@/api/queries/useActivityPlan";
import { useExerciseHistory } from "@/api/queries/useExerciseHistory";
import { useExercises, useRelabelExercise, useRevertExercise } from "@/api/queries/useExercises";
import { EmptyState } from "@/components/EmptyState";
import { InfoPopover } from "@/components/InfoPopover";
import { Skeleton } from "@/components/ui/skeleton";
import { EffortCard, PlanCard, VolumeCard } from "@/features/activity/AnswerCards";
import { planAnswer } from "@/features/activity/answers";
import { hasZoneTime } from "@/features/activity/activityDetails";
import { BodyDiagram } from "@/features/activity/gym/BodyDiagram";
import { ExerciseList } from "@/features/activity/gym/ExerciseList";
import {
  exerciseComparisons,
  gymEffortAnswer,
  volumeAnswer,
} from "@/features/activity/gym/gymAnswers";
import { GymHeartRate } from "@/features/activity/gym/GymHeartRate";
import {
  exerciseRows,
  highlightedMuscles,
  highlightedRows,
  sessionTotals,
  toRelabel,
  totalVolumeG,
  type GymHover,
} from "@/features/activity/gym/gymSession";
import { HrZonesChart } from "@/features/activity/HrZonesChart";
import { MUSCLE_LABELS, maxMuscleLoad, muscleLoad } from "@/lib/muscles";

/**
 * A gym session's page. The answers come first (the plan, the volume against the last
 * session, how hard it was on the heart), then what was lifted with how each exercise
 * compares with the last time, beside the muscles it worked. Garmin sends no muscle data,
 * so the diagram is derived from the exercises (`lib/muscles.ts`).
 */
export function GymActivity({ activity }: { activity: Activity }) {
  const id = activity.summary.id;
  const exercises = useExercises(id);
  const history = useExerciseHistory(id);
  const plan = useActivityPlan(id);
  const relabel = useRelabelExercise(id);
  const revert = useRevertExercise(id);
  const [hover, setHover] = useState<GymHover>(null);
  const busy = relabel.isPending || revert.isPending;
  const error = exercises.error ?? relabel.error ?? revert.error;

  const session = exercises.data;
  const rows = useMemo(() => exerciseRows(session?.exercises ?? []), [session]);
  const comparisons = useMemo(() => exerciseComparisons(rows, history.data), [rows, history.data]);
  const load = useMemo(() => muscleLoad(session?.exercises ?? []), [session]);
  const maxLoad = maxMuscleLoad(load);
  const muscles = highlightedMuscles(rows, hover);
  const marked = highlightedRows(rows, hover);
  const totals = session ? sessionTotals(session) : { sets: null, reps: null };
  const volume = session ? totalVolumeG(session.exercises) : null;

  const { summary } = activity;
  const planned = planAnswer(plan.data);
  const volumeCard = volumeAnswer(
    volume,
    totals.sets,
    totals.reps,
    summary.durationS,
    history.data?.previous,
  );
  const effort = gymEffortAnswer(activity.hrZones, summary.trimp, summary.avgHr, summary.maxHr);

  if (error) return <EmptyState message={error.message} />;
  if (session === undefined) return <Skeleton className="h-[34rem] w-full rounded-2xl" />;
  if (rows.length === 0) {
    return <EmptyState message="Garmin recorded no exercises for this session." />;
  }

  return (
    <>
      <div className="grid gap-5 lg:grid-cols-[repeat(3,minmax(0,1fr))_21rem]">
        {planned ? (
          <PlanCard answer={planned} kind={summary.kind} />
        ) : (
          <VolumeCard
            label="Against the plan"
            big="Not in the plan"
            detail="No prescribed session was matched to this one."
            pill={null}
          />
        )}
        <VolumeCard {...volumeCard} />
        {effort ? (
          <EffortCard answer={effort} />
        ) : (
          <VolumeCard
            label="Effort"
            big="–"
            detail="No heart-rate zones were recorded."
            pill={null}
          />
        )}

        <section
          aria-label="Muscles trained"
          className="bg-card shadow-card order-last flex flex-col gap-3 rounded-2xl border p-5 lg:order-none lg:row-span-2"
        >
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-lg font-semibold">
              {hover?.on === "muscle" ? MUSCLE_LABELS[hover.muscle] : "Muscles trained"}
            </h2>
            <span className="text-muted-foreground text-xs">by volume</span>
          </div>
          <BodyDiagram
            load={load}
            maxLoad={maxLoad}
            highlighted={muscles}
            onHover={(muscle) => setHover(muscle === null ? null : { on: "muscle", muscle })}
          />
        </section>

        <section
          aria-label="Exercises"
          className="bg-card shadow-card rounded-2xl border py-5 lg:col-span-3"
        >
          <div className="flex items-baseline justify-between gap-3 px-6 pb-3">
            <h2 className="text-lg font-semibold">Exercises</h2>
            <span className="text-muted-foreground text-xs">
              The bar is the heaviest set. The tag compares it with the last time.
            </span>
          </div>
          <ExerciseList
            rows={rows}
            comparisons={comparisons}
            highlighted={marked}
            onHover={(index) => setHover(index === null ? null : { on: "exercise", index })}
            onRelabel={(index, label) => relabel.mutate({ index, ...toRelabel(label) })}
            onRevert={(index) => revert.mutate(index)}
            busy={busy}
          />
        </section>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <span className="text-muted-foreground mr-1 text-xs">The rest, one click away</span>
        <InfoPopover
          title="Heart rate"
          trigger={{ kind: "chip", label: "Heart rate over the session" }}
        >
          <GymHeartRate activity={activity} />
        </InfoPopover>
        {hasZoneTime(activity.hrZones) && (
          <InfoPopover
            title="Heart-rate zones"
            trigger={{ kind: "chip", label: "Heart-rate zones" }}
          >
            <HrZonesChart zones={activity.hrZones} />
          </InfoPopover>
        )}
      </div>
    </>
  );
}
