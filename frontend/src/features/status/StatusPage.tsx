import { usePlan, usePlanWeek, useRace } from "@/api/queries/usePlan";
import {
  useGarminStatus,
  useStartSync,
  useSummary,
  useSyncStatus,
  useTrainingLoad,
} from "@/api/queries/useStatus";
import { EmptyState } from "@/components/EmptyState";
import { PlanStrip } from "@/features/plan/PlanStrip";
import { weeklyKmSeries } from "@/features/plan/planView";
import { GymPanel } from "@/features/status/GymPanel";
import { LoadPanel } from "@/features/status/LoadPanel";
import { RacePanel } from "@/features/status/RacePanel";
import { ReadinessPanel } from "@/features/status/ReadinessPanel";
import { StatusPageSkeleton } from "@/features/status/StatusPageSkeleton";
import { SyncStrip } from "@/features/status/SyncStrip";

/** How you are today (readiness, load, the plan, the race) and whether the data is fresh. */
export function StatusPage() {
  const summary = useSummary();
  const load = useTrainingLoad();
  const plan = usePlan();
  const race = useRace();
  const garmin = useGarminStatus();
  const sync = useSyncStatus();
  const startSync = useStartSync();
  // The strip needs the sessions, which the plan payload summarises but does not carry.
  const week = usePlanWeek(plan.data?.today ?? null);

  if (summary.isPending || load.isPending) return <StatusPageSkeleton />;
  if (summary.error) return <EmptyState message={summary.error.message} />;
  if (load.error) return <EmptyState message={load.error.message} />;

  const showRace = summary.data.race.days_to_go >= 0;
  const weeklyKm = race.data ? weeklyKmSeries(race.data.weekly_km, plan.data?.weeks ?? []) : [];

  return (
    <div className="flex flex-col gap-12">
      <div className="grid gap-12 lg:grid-cols-2">
        <ReadinessPanel readiness={summary.data.readiness} />
        {showRace && <RacePanel race={summary.data.race} weeklyKm={weeklyKm} />}
      </div>

      {plan.data && <PlanStrip plan={plan.data} week={week.data} />}

      <LoadPanel load={load.data} />

      {summary.data.gym && <GymPanel gym={summary.data.gym} />}

      {garmin.data && sync.data && (
        <SyncStrip
          garmin={garmin.data}
          sync={sync.data}
          dayRange={summary.data.day_range}
          onSync={() => startSync.mutate()}
          syncStarting={startSync.isPending}
          syncError={startSync.error?.message ?? null}
        />
      )}
    </div>
  );
}
