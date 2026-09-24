import { useMemo } from "react";
import type { Activity } from "@/api/adapters";
import { bestEffortRows, chartedSplits, hasZoneTime } from "@/features/activity/activityDetails";
import { BestEffortsTable } from "@/features/activity/BestEffortsTable";
import { DetailSection } from "@/features/activity/DetailSection";
import { HrZonesChart } from "@/features/activity/HrZonesChart";
import { SplitsChart } from "@/features/activity/SplitsChart";

/** Splits, HR zones and best efforts under the charts, each closed until opened. */
export function ActivityDetails({ activity }: { activity: Activity }) {
  const { kind } = activity.summary;
  const splits = useMemo(() => chartedSplits(activity.splits), [activity.splits]);
  const efforts = useMemo(
    () => bestEffortRows(activity.bestEfforts, kind),
    [activity.bestEfforts, kind],
  );
  const showZones = hasZoneTime(activity.hrZones);

  if (splits.length === 0 && !showZones && efforts.length === 0) return null;

  return (
    <section aria-label="Activity details" className="flex flex-col border-b">
      {splits.length > 0 && (
        <DetailSection title="Splits">
          <SplitsChart splits={splits} kind={kind} />
        </DetailSection>
      )}
      {showZones && (
        <DetailSection title="HR zones">
          <HrZonesChart zones={activity.hrZones} />
        </DetailSection>
      )}
      {efforts.length > 0 && (
        <DetailSection title="Best efforts">
          <BestEffortsTable rows={efforts} />
        </DetailSection>
      )}
    </section>
  );
}
