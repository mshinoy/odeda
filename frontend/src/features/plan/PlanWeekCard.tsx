import type { ReactNode } from "react";
import type { PlanSession } from "@/api/queries/usePlan";
import { StatusDot } from "@/components/StatusDot";
import type { CalendarWeek } from "@/features/plan/planView";
import { sessionLabel, VERDICT_DISPLAY } from "@/features/plan/planView";
import { formatDate, formatDecimal, formatDistance, formatWeekday } from "@/lib/format";
import { cn } from "@/lib/utils";

interface PlanWeekCardProps {
  title: string;
  week: CalendarWeek;
  /** A lighter card: no verdicts are expected yet, and it asks for less room. */
  preview?: boolean;
  /** Fix a match: opens the week's detail under the days. Absent on a preview. */
  onCorrect?: () => void;
  detail?: ReactNode;
}

/**
 * One week laid out as a column of days, like Today's: the weekday, what the plan asks,
 * and how it went. The card says how many sessions and kilometres are done at the top,
 * so the answer is there before the days are read.
 */
export function PlanWeekCard({ title, week, preview, onCorrect, detail }: PlanWeekCardProps) {
  const { summary } = week;
  const days = week.days.filter((day) => day.sessions.length > 0 || !day.isFuture || !preview);

  return (
    <section className="bg-card shadow-card flex flex-col gap-4 rounded-2xl border p-7">
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
          <span className="text-muted-foreground text-sm">
            {summary.sessions_done} of {summary.sessions_prescribed} sessions ·{" "}
            {formatDecimal(summary.actual_km)} of {formatDecimal(summary.planned_km)} km
          </span>
        </div>
        {onCorrect && (
          <button
            type="button"
            onClick={onCorrect}
            className="text-muted-foreground hover:text-foreground text-xs underline underline-offset-4"
          >
            Fix a match
          </button>
        )}
      </header>

      <ol className="flex flex-col divide-y">
        {days.map((day) => (
          <li
            key={day.date}
            className={cn(
              "flex gap-4 py-3 first:pt-0 last:pb-0",
              day.isToday && "bg-muted/40 -mx-3 rounded-lg px-3",
            )}
          >
            <span className="w-20 shrink-0 text-sm">
              <span className={cn("block font-medium", day.isToday && "text-foreground")}>
                {formatWeekday(day.date)}
              </span>
              <span className="text-muted-foreground text-xs">{formatDate(day.date)}</span>
            </span>
            {day.sessions.length === 0 ? (
              <span className="text-muted-foreground/60 text-sm">Nothing planned</span>
            ) : (
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                {day.sessions.map((session) => (
                  <SessionLine key={session.session_ids[0] ?? session.title} session={session} />
                ))}
              </div>
            )}
          </li>
        ))}
      </ol>
      {detail}
    </section>
  );
}

function SessionLine({ session }: { session: PlanSession }) {
  const verdict = VERDICT_DISPLAY[session.verdict];
  const asked = askedLine(session);

  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
      <span className="min-w-0 text-sm">
        <span className="font-medium">{session.title.trim() || sessionLabel(session)}</span>
        {asked && <span className="text-muted-foreground"> · {asked}</span>}
      </span>
      <span className="text-muted-foreground flex items-center gap-3 text-xs">
        {session.actual_m !== null && (
          <span className="tabular-nums">
            {formatDistance(session.actual_m)}
            {session.moved_from && " · moved"}
          </span>
        )}
        {(session.edited || session.own) && <span>{session.own ? "added by you" : "edited"}</span>}
        {session.ignored ? (
          "Ignored"
        ) : session.verdict === "upcoming" ? null : (
          <StatusDot tone={verdict.tone} label={verdict.label} />
        )}
      </span>
    </div>
  );
}

function askedLine(session: PlanSession): string | null {
  const { planned_min_m: lo, planned_max_m: hi } = session;
  if (lo === null) return null;
  if (hi !== null && hi !== lo) return `${formatDistance(lo)}–${formatDistance(hi)}`;
  return formatDistance(lo);
}
