// Everything the plan views turn into words or tones, in one testable place. The
// backend decides the verdicts; this decides only how they read.
import type { Plan, PlanSession, PlanVerdict, PlanWeek } from "@/api/queries/usePlan";
import type { WeeklyKmWeek } from "@/charts/plan/buildWeeklyKmOption";
import { formatDistance, formatPercent, formatWeekday } from "@/lib/format";

type Tone = "good" | "warning" | "serious" | "critical" | "neutral";

/**
 * A verdict always arrives with a word beside its colour (Rules). Red means a session
 * that did not happen and nothing else — never a bad day, never a slow one.
 */
export const VERDICT_DISPLAY: Record<PlanVerdict, { label: string; tone: Tone }> = {
  done: { label: "Done", tone: "good" },
  short: { label: "Short", tone: "warning" },
  missed: { label: "Missed", tone: "critical" },
  substituted: { label: "Swapped", tone: "neutral" },
  "rest-kept": { label: "Rest", tone: "good" },
  "rest-broken": { label: "Ran on a rest day", tone: "warning" },
  upcoming: { label: "To come", tone: "neutral" },
};

const KIND_LABEL: Record<string, string> = {
  race: "race",
  long: "long run",
  quality: "quality session",
  easy: "easy run",
  cross: "cross-training",
  gym: "gym",
  rest: "rest",
};

const SPORT_LABEL: Record<string, string> = {
  running: "run",
  cycling: "ride",
  strength: "gym",
  swimming: "swim",
  walking: "walk",
  rest: "rest",
};

/** "run", "ride", "gym" — the plan's sport vocabulary in the owner's words. */
export function sportLabel(sport: string | null): string {
  return (sport ? SPORT_LABEL[sport] : undefined) ?? "session";
}

/** "long run", "ride", "gym". The kind is more specific than the sport, so it wins. */
export function sessionLabel(session: Pick<PlanSession, "sport" | "kind">): string {
  const byKind = session.kind ? KIND_LABEL[session.kind] : undefined;
  if (byKind) return byKind;
  return sportLabel(session.sport);
}

/** "Friday · long run · 18 km", the distance dropped when the plan did not set one. */
export function sessionLine(
  session: Pick<PlanSession, "day" | "sport" | "kind" | "planned_min_m">,
): string {
  const parts = [formatWeekday(session.day), sessionLabel(session)];
  if (session.planned_min_m) parts.push(formatDistance(session.planned_min_m));
  return parts.join(" · ");
}

/**
 * The sentence at the top of `/plan`.
 *
 * Adherence alone flatters: a 16 km run at the wrong effort is `done` exactly like a
 * good one, so the number is only ever shown beside what the training produced (T37).
 * This says what happened; the line under it says whether it worked.
 */
export function verdictSentence(plan: Plan): string {
  if (!plan.subscribed) return "No training plan is connected.";
  if (plan.weeks.length === 0) return "The calendar is connected but has prescribed nothing yet.";

  const week = plan.this_week;
  const adherence = plan.adherence_4wk;
  if (!week) {
    return adherence === null
      ? "Nothing prescribed this week."
      : `Nothing prescribed this week. ${formatPercent(adherence)} over the last four.`;
  }

  const done = `${week.sessions_done} of ${week.sessions_prescribed} sessions this week`;
  if (adherence === null) return `${done}.`;
  return `${done}, and ${formatPercent(adherence)} over the last four.`;
}

export interface EfficacyInput {
  /** Long runs recently, newest last; only `decoupling_pct` is read. */
  decoupling: readonly { decoupling_pct: number | null; aerobically_durable: boolean }[];
  /** Seconds, from `/api/race`. Null with no usable best effort. */
  projectedSeconds: number | null;
}

/**
 * Whether the training is working, beside whether it happened.
 *
 * Adherence measures compliance and nothing else: a 16 km run at the wrong effort is
 * `done` exactly like a good one (T37). Decoupling is the number that says whether the
 * sessions produced anything, which is why the two are never shown apart.
 */
export function efficacySentence({ decoupling, projectedSeconds }: EfficacyInput): string | null {
  const usable = decoupling.filter((d) => d.decoupling_pct !== null).slice(-6);
  if (usable.length === 0) {
    return projectedSeconds === null ? null : "No long run yet with the heart rate to judge it by.";
  }
  const durable = usable.filter((d) => d.aerobically_durable).length;
  return `${durable} of the last ${usable.length} long runs held together to the end.`;
}

/** Rolling adherence against the four weeks before it, for the stat card's delta. */
export function adherenceDelta(weeks: readonly PlanWeek[]): number | null {
  const judged = weeks.filter((w) => w.adherence_pct !== null);
  if (judged.length < 2) return null;
  const recent = judged.slice(-4);
  const earlier = judged.slice(-8, -4);
  if (earlier.length === 0) return null;
  return mean(recent) - mean(earlier);
}

function mean(weeks: readonly PlanWeek[]): number {
  const total = weeks.reduce((sum, w) => sum + (w.adherence_pct ?? 0), 0);
  return total / weeks.length;
}

/**
 * The weeks worth drawing: from four weeks back to race week.
 *
 * The whole block is twelve weeks and the grid shows all of it, but a plan re-synced
 * mid-block can carry weeks from an older one, and a wall of finished weeks pushes
 * the only actionable row off the screen.
 */
export function gridWeeks(weeks: readonly PlanWeek[], today: string): readonly PlanWeek[] {
  const current = weeks.findIndex((w) => w.start <= today && today < addDays(w.start, 7));
  if (current < 0) return weeks;
  return weeks.slice(Math.max(current - 4, 0));
}

function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * The activities a session can be re-linked to: unclaimed ones within a day of it.
 *
 * Not every activity in the week. A manual link is read by the matcher only while it
 * is looking at the session's own day and the two either side of it, so offering
 * Sunday's run for Wednesday's session would be a button that silently does nothing.
 */
export function linkCandidates<T extends { activity_id: string; day: string }>(
  session: Pick<PlanSession, "day" | "activity_id">,
  unplanned: readonly T[],
): T[] {
  return unplanned.filter(
    (a) => a.activity_id !== session.activity_id && Math.abs(daysBetween(a.day, session.day)) <= 1,
  );
}

function daysBetween(a: string, b: string): number {
  const ms = new Date(`${a}T00:00:00Z`).getTime() - new Date(`${b}T00:00:00Z`).getTime();
  return Math.round(ms / 86_400_000);
}

/** Whether a week is the one `today` falls in, for the grid's current row. */
export function isCurrentWeek(week: PlanWeek, today: string): boolean {
  return week.start <= today && today < addDays(week.start, 7);
}

/**
 * What was run each week against what was prescribed, for the race panel's chart.
 *
 * The two sides come from different endpoints and neither covers the other: `/api/race`
 * has only weeks with running in them, and the plan has weeks still to come. The union
 * keyed on the Monday is what makes the dashed line continue past the last bar, which
 * is the half of the chart that answers "does the curve reach January".
 */
export function weeklyKmSeries(
  ran: readonly { start: string; km: number }[],
  planned: readonly PlanWeek[],
  count = 20,
): WeeklyKmWeek[] {
  const kmByWeek = new Map(ran.map((w) => [w.start, w.km]));
  const plannedByWeek = new Map(planned.map((w) => [w.start, w.planned_km]));
  const mondays = [...new Set([...kmByWeek.keys(), ...plannedByWeek.keys()])].sort();

  return mondays.slice(-count).map((start) => ({
    start,
    km: kmByWeek.get(start) ?? 0,
    // A week the plan never mentioned has no prescription, which is not the same as a
    // prescription of zero: the line breaks there rather than diving to the axis.
    plannedKm: plannedByWeek.get(start) ?? null,
  }));
}
