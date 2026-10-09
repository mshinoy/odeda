import { Link } from "react-router-dom";
import type { Plan, PlanSession, PlanWeekDetail } from "@/api/queries/usePlan";
import { StatCard } from "@/components/StatCard";
import { StatusDot } from "@/components/StatusDot";
import { adherenceDelta, sessionLine, VERDICT_DISPLAY } from "@/features/plan/planView";
import { formatDecimal, formatDelta, formatPercent, formatWeekday } from "@/lib/format";

/**
 * This week against the plan, on Status: what each day asked for and what became of
 * it, what is next, and whether the last four weeks held up.
 *
 * Status is the home dashboard rather than a peer page (D11), so this summarises the
 * `/plan` tab instead of making it redundant: the strip answers "what today, am I on
 * it", the tab holds the twelve-week grid.
 */
export function PlanStrip({ plan, week }: { plan: Plan; week: PlanWeekDetail | undefined }) {
  if (!plan.subscribed) {
    return (
      <section className="flex flex-col items-start gap-2 text-sm">
        <span className="text-muted-foreground">No training plan is connected.</span>
        <Link to="/settings" className="underline underline-offset-4">
          Connect the calendar
        </Link>
      </section>
    );
  }

  const summary = plan.this_week;
  const delta = adherenceDelta(plan.weeks);
  const sessions = week?.sessions ?? [];

  return (
    <section className="flex flex-col gap-6">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-sm font-medium">This week</h2>
        <Link
          to="/plan"
          className="text-muted-foreground hover:text-foreground text-xs underline underline-offset-4"
        >
          The whole plan
        </Link>
      </div>

      <div className="grid gap-8 lg:grid-cols-[2fr_1fr]">
        <div className="flex max-w-md flex-col gap-3">
          {sessions.length === 0 ? (
            <span className="text-muted-foreground text-sm">Nothing prescribed this week.</span>
          ) : (
            sessions.map((session) => <SessionRow key={session.day} session={session} />)
          )}
          {plan.next_session && (
            <span className="text-muted-foreground pt-1 text-xs">
              Next: {sessionLine(plan.next_session)}
            </span>
          )}
        </div>

        <StatCard
          label="Adherence, 4 weeks"
          value={formatPercent(plan.adherence_4wk)}
          delta={delta === null ? undefined : formatDelta(delta)}
          deltaTone={deltaTone(delta)}
        />
      </div>

      {summary && (
        <span className="text-muted-foreground text-xs">
          {summary.sessions_done} of {summary.sessions_prescribed} sessions ·{" "}
          {formatDecimal(summary.actual_km)} of {formatDecimal(summary.planned_km)} km
        </span>
      )}
    </section>
  );
}

function SessionRow({ session }: { session: PlanSession }) {
  const verdict = VERDICT_DISPLAY[session.verdict];
  return (
    // Fixed columns rather than a spread row: the verdict belongs beside the session
    // it judges, not pushed to the far edge of whatever space the panel happens to have.
    <div className="grid grid-cols-[2.5rem_minmax(0,1fr)_7rem] items-baseline gap-3 text-sm">
      <span className="text-muted-foreground">{formatWeekday(session.day)}</span>
      <span className="truncate">{session.title}</span>
      <span className="text-muted-foreground text-xs">
        <StatusDot tone={verdict.tone} label={verdict.label} />
      </span>
    </div>
  );
}

function deltaTone(delta: number | null): "good" | "bad" | "neutral" {
  if (delta === null || Math.round(delta) === 0) return "neutral";
  return delta > 0 ? "good" : "bad";
}
