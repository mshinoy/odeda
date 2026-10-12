import { useEffect, useRef } from "react";
import type { CalendarWeek } from "@/features/plan/planView";
import { PlanDayCell } from "@/features/plan/PlanDayCell";
import { formatDecimal, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Seven day columns and a summary rail, the same grid for the header and every row. */
const COLUMNS = "grid grid-cols-[4.5rem_repeat(7,minmax(0,1fr))_7rem] gap-2";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

interface PlanCalendarProps {
  weeks: readonly CalendarWeek[];
  openWeek: string | null;
  onOpenWeek: (start: string) => void;
  /** Rendered under the week it belongs to, so a correction happens next to the day. */
  renderDetail: (week: CalendarWeek) => React.ReactNode;
}

/**
 * The block as a calendar: a week across, the weeks stacked down.
 *
 * The page opens scrolled to the current week rather than trimming the finished ones.
 * The old table cut everything before four weeks ago to keep the actionable row on
 * screen; that threw away the shape of the build, which is the thing a plan is for.
 */
export function PlanCalendar({ weeks, openWeek, onOpenWeek, renderDetail }: PlanCalendarProps) {
  const current = useRef<HTMLDivElement>(null);

  useEffect(() => {
    current.current?.scrollIntoView({ block: "center" });
    // Once, on arrival. Re-running would yank the page back every time a link is
    // corrected, which is exactly when the owner is reading somewhere else.
  }, []);

  return (
    <section className="flex flex-col gap-2">
      {/* Sticky, so the day a cell is under is still answerable twenty weeks down. That
          is also what lets a cell drop its own weekday label and spend the line on the
          session's name instead. */}
      <div
        className={cn(
          COLUMNS,
          // `top-14` parks it under the shell's own sticky header (h-14, z-20), and
          // z-10 keeps it below that rather than sliding over the nav.
          "bg-background text-muted-foreground sticky top-14 z-10 px-1 py-2 text-xs",
        )}
      >
        <span>Week</span>
        {WEEKDAYS.map((day) => (
          <span key={day}>{day}</span>
        ))}
        <span className="text-right">Done</span>
      </div>

      {weeks.map((week) => (
        <div key={week.week} ref={week.isCurrent ? current : undefined}>
          <div
            className={cn(
              COLUMNS,
              "items-stretch rounded-lg px-1 py-1",
              week.isCurrent && "bg-muted/40",
            )}
          >
            <span className="text-muted-foreground self-center text-xs">
              {monthDay(week.start)}
            </span>

            {week.days.map((day) => (
              <PlanDayCell key={day.date} day={day} onOpen={() => onOpenWeek(week.start)} />
            ))}

            <span className="text-muted-foreground flex flex-col items-end justify-center gap-0.5 text-xs tabular-nums">
              <span className="text-foreground text-sm">
                {formatPercent(week.summary.adherence_pct)}
              </span>
              <span>
                {week.summary.sessions_done}/{week.summary.sessions_prescribed} sessions
              </span>
              <span>
                {formatDecimal(week.summary.actual_km)}/{formatDecimal(week.summary.planned_km)} km
              </span>
            </span>
          </div>

          {openWeek === week.start && renderDetail(week)}
        </div>
      ))}
    </section>
  );
}

/** "6 Oct" — the week's Monday, enough to find a week without repeating the year. */
function monthDay(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  return `${date.getUTCDate()} ${date.toLocaleString("en", { month: "short", timeZone: "UTC" })}`;
}
