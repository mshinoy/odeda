import { ChevronDown } from "lucide-react";
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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { PlanStrip } from "@/features/plan/PlanStrip";
import { weeklyKmSeries } from "@/features/plan/planView";
import { GymPanel } from "@/features/status/GymPanel";
import { LoadPanel } from "@/features/status/LoadPanel";
import { SyncStrip } from "@/features/status/SyncStrip";
import { RaceCard } from "@/features/today/RaceCard";
import { StatTiles } from "@/features/today/StatTiles";
import { TodayCard } from "@/features/today/TodayCard";
import { TodayPageSkeleton } from "@/features/today/TodayPageSkeleton";
import { WeekCard } from "@/features/today/WeekCard";
import { headline, previousWeekStart, sleepNights, weekDays } from "@/features/today/todayView";
import { formatWeekday } from "@/lib/format";

/**
 * Today: what to do, how ready you are, where the race is heading, and whether the
 * week is going to plan. Everything else the old Status page held is one toggle down.
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
    <div className="flex flex-col gap-5">
      <div className="grid gap-5 lg:grid-cols-[3fr_2fr]">
        <TodayCard
          day={today}
          headline={lines}
          readiness={summary.data.readiness}
          nights={sleepNights(daily.data?.rows ?? [])}
        />
        {raceSummary && <RaceCard race={raceSummary} forecast={forecast.data} />}
      </div>

      {plan.data?.subscribed ? (
        <WeekCard
          plan={plan.data}
          thisWeek={thisWeek.data}
          lastWeek={lastWeek.data}
          weeklyKm={weeklyKm}
        />
      ) : (
        plan.data && <PlanStrip plan={plan.data} week={undefined} />
      )}

      <StatTiles
        load={load.data.current}
        latest={latest.data?.rows[0]}
        kmDonePct={forecast.data?.form?.km_done_pct ?? null}
      />

      <Collapsible className="flex flex-col gap-6">
        <CollapsibleTrigger className="text-muted-foreground hover:text-foreground group flex items-center gap-1 self-start text-sm">
          Training load and gym
          <ChevronDown className="size-4 transition-transform group-data-[state=open]:rotate-180" />
        </CollapsibleTrigger>
        <CollapsibleContent className="flex flex-col gap-12 pt-2">
          <LoadPanel load={load.data} />
          {summary.data.gym && <GymPanel gym={summary.data.gym} />}
        </CollapsibleContent>
      </Collapsible>

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
