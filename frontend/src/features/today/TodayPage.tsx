import { useSetup } from "@/api/queries/useBasics";
import { useDaily } from "@/api/queries/useHealth";
import { useActivities } from "@/api/queries/useActivities";
import { usePlan, usePlanWeek, useRace, useRaceForecast } from "@/api/queries/usePlan";
import {
  useGarminStatus,
  useStartSync,
  useSummary,
  useSyncStatus,
  useTrainingLoad,
} from "@/api/queries/useStatus";
import { EmptyState } from "@/components/EmptyState";
import { weeklyKmSeries } from "@/features/plan/planView";
import { FirstRunCard } from "@/features/today/FirstRunCard";
import { showFirstRun } from "@/features/today/firstRun";
import { NamedPlanBadge } from "@/features/plan/NamedPlanBadge";
import { NoPlanNotice } from "@/features/today/NoPlanNotice";
import { SyncStrip } from "@/features/status/SyncStrip";
import { RaceCard } from "@/features/today/RaceCard";
import { StatTiles } from "@/features/today/StatTiles";
import { TodayCard } from "@/features/today/TodayCard";
import { TodayPageSkeleton } from "@/features/today/TodayPageSkeleton";
import { ProgressCard } from "@/features/today/ProgressCard";
import { WeekColumn } from "@/features/today/WeekColumn";
import { headline, previousWeekStart, sleepNights, weekDays } from "@/features/today/todayView";
import { formatWeekday } from "@/lib/format";

/**
 * Today: what to do, how ready you are, where the race is heading, and whether the
 * week is going to plan. The load and gym detail the old Status page held moved to Train.
 */
export function TodayPage() {
  const summary = useSummary();
  const load = useTrainingLoad();
  const plan = usePlan();
  const race = useRace();
  const forecast = useRaceForecast();
  const daily = useDaily(7);
  const latest = useActivities({ limit: 1, offset: 0 });
  const garmin = useGarminStatus();
  const sync = useSyncStatus();
  const startSync = useStartSync();
  const setup = useSetup();

  const thisStart = plan.data?.this_week?.start ?? plan.data?.today ?? null;
  const thisWeek = usePlanWeek(thisStart);
  const lastWeek = usePlanWeek(thisStart ? previousWeekStart(thisStart) : null);

  if (summary.isPending || load.isPending) return <TodayPageSkeleton />;
  if (summary.error) return <EmptyState message={summary.error.message} />;
  if (load.error) return <EmptyState message={load.error.message} />;

  const today = plan.data?.today ?? summary.data.readiness.day ?? "";
  const todaySessions =
    thisWeek.data && plan.data
      ? (weekDays(thisWeek.data.start, thisWeek.data.sessions, plan.data.today).find(
          (d) => d.isToday,
        )?.sessions ?? [])
      : [];
  const next = plan.data?.next_session ?? null;
  const lines = headline(
    todaySessions,
    next ? { weekday: formatWeekday(next.day), title: next.title } : null,
  );
  const raceSummary = summary.data.race;
  const weeklyKm = race.data ? weeklyKmSeries(race.data.weekly_km, plan.data?.weeks ?? []) : [];

  return (
    <div className="short:gap-3 flex flex-col gap-5">
      {setup.data && showFirstRun(setup.data) && <FirstRunCard setup={setup.data} />}
      {plan.data?.named_plan && <NamedPlanBadge plan={plan.data.named_plan} />}
      <div className="short:gap-3 grid gap-5 lg:min-h-[calc(100svh-13rem)] lg:grid-cols-[minmax(0,1fr)_26rem]">
        <div className="short:gap-3 flex min-w-0 flex-col gap-5">
          <div className="short:gap-3 grid gap-5 lg:grid-cols-[1.35fr_1fr]">
            <TodayCard
              day={today}
              headline={lines}
              readiness={summary.data.readiness}
              nights={sleepNights(daily.data?.rows ?? [])}
              longRun={forecast.data?.long_run ?? null}
            />
            {raceSummary && <RaceCard race={raceSummary} forecast={forecast.data} />}
          </div>
          <StatTiles
            load={load.data.current}
            latest={latest.data?.rows[0]}
            kmDonePct={forecast.data?.form?.km_done_pct ?? null}
          />
          {plan.data?.subscribed && (
            <ProgressCard weeklyKm={weeklyKm} thisStart={thisStart ?? today} />
          )}
        </div>

        {plan.data?.subscribed ? (
          <WeekColumn plan={plan.data} thisWeek={thisWeek.data} lastWeek={lastWeek.data} />
        ) : (
          plan.data && <NoPlanNotice />
        )}
      </div>

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
