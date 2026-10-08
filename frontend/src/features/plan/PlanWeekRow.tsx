import type { PlanWeek } from "@/api/queries/usePlan";
import { StatusDot } from "@/components/StatusDot";
import { VERDICT_DISPLAY } from "@/features/plan/planView";
import { formatDate, formatDecimal, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";

const COLUMNS = "grid w-full grid-cols-[7rem_4rem_1fr_3rem] items-baseline gap-4 px-2 text-sm";

/** The grid's one header row, so 2/5 and 31% are not left to be guessed at. */
export function PlanWeekHeader() {
  return (
    <div className={cn(COLUMNS, "text-muted-foreground pb-2 text-xs")}>
      <span>Week</span>
      <span>Sessions</span>
      <span>Distance</span>
      <span className="text-right">Done</span>
    </div>
  );
}

interface PlanWeekRowProps {
  week: PlanWeek;
  current: boolean;
  open: boolean;
  onToggle: () => void;
}

/**
 * One week of the grid.
 *
 * A week still to come is shown as what it asks for and nothing else: its sessions are
 * deliberately not counted until the day is over (T37), so printing `0/0` and a grey
 * "long run to come" on every future row says nothing twelve times over.
 */
export function PlanWeekRow({ week, current, open, onToggle }: PlanWeekRowProps) {
  const judged = week.adherence_pct !== null;
  const longRun = judged && week.long_run ? VERDICT_DISPLAY[week.long_run] : null;

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className={cn(
        COLUMNS,
        "hover:bg-muted/50 rounded-md py-2 text-left transition-colors",
        current && "bg-muted/40",
      )}
    >
      <span className={cn("text-muted-foreground", current && "text-foreground font-medium")}>
        {formatDate(week.start)}
      </span>
      <span className="tabular-nums">
        {judged ? `${week.sessions_done}/${week.sessions_planned}` : "—"}
      </span>
      <span className="text-muted-foreground">
        {judged
          ? `${formatDecimal(week.actual_km)} of ${formatDecimal(week.planned_km)} km`
          : `${formatDecimal(week.planned_km)} km to run`}
        {longRun && (
          <>
            {" · "}
            <StatusDot tone={longRun.tone} label={`long run ${longRun.label.toLowerCase()}`} />
          </>
        )}
      </span>
      <span className="text-right tabular-nums">{formatPercent(week.adherence_pct)}</span>
    </button>
  );
}
