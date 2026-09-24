import {
  useGarminStatus,
  useStartSync,
  useSummary,
  useSyncStatus,
  useTrainingLoad,
} from "@/api/queries/useStatus";
import { EmptyState } from "@/components/EmptyState";
import { LoadPanel } from "@/features/status/LoadPanel";
import { RacePanel } from "@/features/status/RacePanel";
import { ReadinessPanel } from "@/features/status/ReadinessPanel";
import { StatusPageSkeleton } from "@/features/status/StatusPageSkeleton";
import { SyncStrip } from "@/features/status/SyncStrip";

/** How you are today (readiness, load, race) and whether the data behind it is fresh. */
export function StatusPage() {
  const summary = useSummary();
  const load = useTrainingLoad();
  const garmin = useGarminStatus();
  const sync = useSyncStatus();
  const startSync = useStartSync();

  if (summary.isPending || load.isPending) return <StatusPageSkeleton />;
  if (summary.error) return <EmptyState message={summary.error.message} />;
  if (load.error) return <EmptyState message={load.error.message} />;

  const showRace = summary.data.race.days_to_go >= 0;

  return (
    <div className="flex flex-col gap-12">
      <div className="grid gap-12 lg:grid-cols-2">
        <ReadinessPanel readiness={summary.data.readiness} />
        {showRace && <RacePanel race={summary.data.race} />}
      </div>

      <LoadPanel load={load.data} />

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
