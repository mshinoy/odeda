import { useMemo } from "react";
import type { Activity } from "@/api/adapters";
import { InfoPopover } from "@/components/InfoPopover";
import { bestEffortRows, hasZoneTime } from "@/features/activity/activityDetails";
import { BestEffortsTable } from "@/features/activity/BestEffortsTable";
import { detailRows } from "@/features/activity/details";
import { HrZonesChart } from "@/features/activity/HrZonesChart";

/**
 * What used to be three folded sections and six big numbers, as chips that open a popup:
 * the answer is on the page, and the rest is one click away without moving anything.
 */
export function ActivityChips({
  activity,
  newBests,
}: {
  activity: Activity;
  /** The records this activity holds, e.g. "10 k". */
  newBests: readonly string[];
}) {
  const { kind } = activity.summary;
  const efforts = useMemo(
    () => bestEffortRows(activity.bestEfforts, kind),
    [activity.bestEfforts, kind],
  );
  const rows = useMemo(() => detailRows(activity), [activity]);

  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="text-muted-foreground mr-1 text-xs">The rest, one click away</span>

      {hasZoneTime(activity.hrZones) && (
        <InfoPopover title="Heart-rate zones" trigger={{ kind: "chip", label: "Heart-rate zones" }}>
          <HrZonesChart zones={activity.hrZones} />
        </InfoPopover>
      )}

      {efforts.length > 0 && (
        <InfoPopover
          title="Best efforts"
          trigger={{
            kind: "chip",
            label: "Best efforts",
            ...(newBests.length > 0 ? { badge: `new best: ${newBests.join(", ")}` } : {}),
          }}
        >
          <p>The fastest stretch of each standard distance inside this activity.</p>
          <BestEffortsTable rows={efforts} />
        </InfoPopover>
      )}

      {rows.length > 0 && (
        <InfoPopover title="Details" trigger={{ kind: "chip", label: "Details" }}>
          <dl className="flex flex-col gap-2">
            {rows.map((row) => (
              <div key={row.label} className="flex flex-col">
                <div className="flex items-baseline justify-between gap-4">
                  <dt>{row.label}</dt>
                  <dd className="text-foreground font-medium tabular-nums">{row.value}</dd>
                </div>
                {row.note && <span className="text-muted-foreground text-xs">{row.note}</span>}
              </div>
            ))}
          </dl>
        </InfoPopover>
      )}
    </div>
  );
}
