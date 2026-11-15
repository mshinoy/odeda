import type { ReactNode } from "react";
import { StatusDot } from "@/components/StatusDot";
import type { CalendarDay, CalendarWeek } from "@/features/plan/planView";
import { dayVerdict, VERDICT_DISPLAY } from "@/features/plan/planView";
import { formatDate, formatDecimal, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";

const DOT_TONE: Record<string, string> = {
  good: "bg-status-good",
  warning: "bg-status-warning",
  critical: "bg-status-critical",
  neutral: "bg-muted-foreground",
};

interface PlanHistoryProps {
  weeks: readonly CalendarWeek[];
  openWeek: string | null;
  onOpenWeek: (start: string) => void;
  renderDetail: () => ReactNode;
}

/** Past weeks, newest first, one compact row each; a row opens that week's detail. */
export function PlanHistory({ weeks, openWeek, onOpenWeek, renderDetail }: PlanHistoryProps) {
  if (weeks.length === 0) return null;

  return (
    <section className="bg-card shadow-card flex flex-col gap-4 rounded-2xl border p-7">
      <header className="flex flex-col gap-0.5">
        <h2 className="text-xl font-semibold tracking-tight">Past weeks</h2>
        <p className="text-muted-foreground text-sm">
          Choose a week to see its days and fix a match.
        </p>
        <HistoryLegend />
      </header>
      <ul className="flex flex-col">
        {weeks.map((week) => (
          <li key={week.week} className="border-t first:border-t-0">
            <button
              type="button"
              onClick={() => onOpenWeek(week.start)}
              aria-expanded={openWeek === week.start}
              className="hover:bg-muted/40 grid w-full grid-cols-[4.5rem_1fr_auto] items-center gap-4 rounded-lg px-1 py-3 text-left transition-colors sm:grid-cols-[4.5rem_1fr_7rem_auto]"
            >
              <span className="text-sm font-medium">{formatDate(week.start)}</span>
              <span className="flex items-center gap-1.5" aria-label="Days of the week">
                {week.days.map((day) => (
                  <DayDot key={day.date} day={day} />
                ))}
              </span>
              <span className="text-muted-foreground hidden text-xs tabular-nums sm:block">
                {formatDecimal(week.summary.actual_km)} / {formatDecimal(week.summary.planned_km)}{" "}
                km
              </span>
              <span className="w-10 text-right text-sm font-medium tabular-nums">
                {formatPercent(week.summary.adherence_pct)}
              </span>
            </button>
            {openWeek === week.start && renderDetail()}
          </li>
        ))}
      </ul>
    </section>
  );
}

function DayDot({ day }: { day: CalendarDay }) {
  const verdict = dayVerdict(day);
  if (verdict === null) {
    return <span className="border-muted-foreground/30 size-3 rounded-full border" aria-hidden />;
  }
  const { tone, label } = VERDICT_DISPLAY[verdict];
  return (
    <span
      className={cn("size-3 rounded-full", DOT_TONE[tone])}
      title={`${formatDate(day.date)}: ${label}`}
      aria-label={`${formatDate(day.date)}: ${label}`}
    />
  );
}

/** Used in the week list's legend: every verdict a dot can show, with its word. */
export function HistoryLegend() {
  return (
    <p className="text-muted-foreground flex flex-wrap gap-x-4 text-xs">
      <StatusDot tone="good" label="Done" />
      <StatusDot tone="warning" label="Short" />
      <StatusDot tone="critical" label="Missed" />
      <StatusDot tone="neutral" label="Swapped" />
    </p>
  );
}
