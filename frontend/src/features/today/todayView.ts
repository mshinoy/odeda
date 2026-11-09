// What the Today page says, worked out in one testable place. The backend decides what
// was done and what was missed; this decides only how a week and a night of sleep read.
import type { PlanSession, PlanVerdict } from "@/api/queries/usePlan";
import type { DailyRow } from "@/api/queries/useHealth";
import type { ActivityKind } from "@/lib/activityKind";
import { formatDistance, formatWeekday } from "@/lib/format";

/** The plan names sports differently from Garmin's activity types; both end as a kind. */
const KIND_BY_PLAN_SPORT: Readonly<Record<string, ActivityKind>> = {
  running: "run",
  cycling: "ride",
  swimming: "swim",
  strength: "strength",
  walking: "walk",
};

export interface DaySession {
  title: string;
  kind: ActivityKind;
  verdict: PlanVerdict;
  /** "Done · 5.6 km", "Short · 1.5 of 8 km", "Missed"; empty for a session still to come. */
  outcome: string;
  optional: boolean;
}

export interface DayView {
  day: string;
  weekday: string;
  /** Day of the month. */
  date: number;
  isToday: boolean;
  /** Worst thing that happened that day, for the tile's tint; null while nothing has. */
  tone: "good" | "warning" | "critical" | null;
  sessions: DaySession[];
}

function outcomeLine(session: PlanSession): string {
  const actual = session.actual_m !== null ? formatDistance(session.actual_m) : null;
  const asked = session.planned_min_m !== null ? formatDistance(session.planned_min_m) : null;
  switch (session.verdict) {
    case "done":
      return actual ? `Done · ${actual}` : "Done";
    case "short":
      return actual && asked ? `Short · ${actual} of ${asked}` : "Short";
    case "missed":
      return "Missed";
    case "substituted":
      return "Swapped";
    case "rest-kept":
      return "Rest";
    case "rest-broken":
      return "Ran on a rest day";
    case "upcoming":
      return "";
  }
}

/**
 * The tile's tint: the worst thing that happened, and only for sessions that count. An
 * optional session skipped is not a miss, and a day still to come has no tint at all.
 */
function dayTone(sessions: readonly PlanSession[]): DayView["tone"] {
  const counted = sessions.filter(
    (s) => !s.optional && !s.ignored && s.verdict !== "upcoming" && s.verdict !== "rest-kept",
  );
  if (counted.length === 0) return null;
  if (counted.some((s) => s.verdict === "missed")) return "critical";
  if (counted.some((s) => s.verdict === "short" || s.verdict === "rest-broken")) return "warning";
  return "good";
}

function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + n));
  return date.toISOString().slice(0, 10);
}

/** Seven tiles from a Monday, each with that day's sessions and what became of them. */
export function weekDays(
  start: string,
  sessions: readonly PlanSession[],
  today: string,
): DayView[] {
  return Array.from({ length: 7 }, (_, i) => {
    const day = addDays(start, i);
    const mine = sessions.filter((s) => s.day === day && s.sport !== "rest");
    return {
      day,
      weekday: formatWeekday(day),
      date: Number(day.slice(8, 10)),
      isToday: day === today,
      tone: dayTone(mine),
      sessions: mine.map((s) => ({
        title: s.title.trim() || (s.sport ?? "Session"),
        kind: (s.sport ? KIND_BY_PLAN_SPORT[s.sport] : undefined) ?? "other",
        verdict: s.verdict,
        outcome: s.ignored ? "Ignored" : outcomeLine(s),
        optional: s.optional,
      })),
    };
  });
}

/** The Monday of the week before the one starting `start`. */
export function previousWeekStart(start: string): string {
  return addDays(start, -7);
}

export interface Headline {
  /** What the big line says: today's session, or what comes next, or that there is none. */
  title: string;
  /** "Today", "Done today", "Next, Tuesday": how to read the title. */
  label: string;
}

/**
 * Today's one line. A session still to do leads; once everything asked of today is done
 * it says so; a day with nothing says rest and points at the next session.
 */
export function headline(
  today: readonly DaySession[],
  next: { weekday: string; title: string } | null,
): Headline {
  const counted = today.filter((s) => !s.optional);
  const pending = counted.find((s) => s.verdict === "upcoming");
  if (pending) return { label: "Today", title: pending.title };
  if (counted.length > 0) return { label: "Today", title: "Today's sessions are done" };
  if (next) return { label: `Rest day · next, ${next.weekday}`, title: next.title };
  return { label: "Today", title: "Rest day" };
}

export interface SleepNight {
  day: string;
  hours: number | null;
}

/** The last `count` nights, oldest first; a night with no recording keeps its place. */
export function sleepNights(rows: readonly DailyRow[], count = 7): SleepNight[] {
  return rows.slice(-count).map((r) => ({
    day: r.day,
    hours: r.total_sleep_s === null ? null : r.total_sleep_s / 3600,
  }));
}

/** How many of the nights have a recording at all. Garmin leaves some out. */
export function recordedNights(nights: readonly SleepNight[]): number {
  return nights.filter((n) => n.hours !== null).length;
}

/** Mean of the nights that were recorded, or null when none were. */
export function sleepAverage(nights: readonly SleepNight[]): number | null {
  const recorded = nights.flatMap((n) => (n.hours === null ? [] : [n.hours]));
  if (recorded.length === 0) return null;
  return recorded.reduce((a, b) => a + b, 0) / recorded.length;
}

/** Bar heights as a share of the tallest night, with a floor so a short one still shows. */
export function sleepBarHeights(nights: readonly SleepNight[]): (number | null)[] {
  const tallest = Math.max(8, ...nights.map((n) => n.hours ?? 0));
  return nights.map((n) =>
    n.hours === null ? null : Math.max(8, Math.round((n.hours / tallest) * 100)),
  );
}

/**
 * The weeks worth charting beside today: some behind it, which is the progress so far,
 * and a couple ahead for what is asked next. The series runs to race week, so taking its
 * tail would draw nothing but the future.
 */
export function weeksAround<T extends { start: string }>(
  weeks: readonly T[],
  thisStart: string,
  before = 6,
  after = 2,
): T[] {
  const at = weeks.findIndex((w) => w.start >= thisStart);
  const centre = at === -1 ? weeks.length : at;
  return weeks.slice(Math.max(0, centre - before), centre + after + 1);
}

/**
 * A day in one line for the compact week: what became of it, in words. Several sessions
 * with the same fate are counted ("Missed, 2 sessions"); a mixed day leads with its worst
 * and says how many more there were.
 */
export function daySummary(day: DayView): string {
  if (day.sessions.length === 0) return "Rest";
  const resolved = day.sessions.filter((s) => s.outcome !== "");
  if (resolved.length === 0) return "To come";
  const rank: Record<string, number> = { missed: 0, short: 1, "rest-broken": 1, done: 2 };
  const worst = [...resolved].sort((a, b) => (rank[a.verdict] ?? 3) - (rank[b.verdict] ?? 3))[0];
  if (!worst) return "To come";
  if (resolved.length === 1) return worst.outcome;
  const same = resolved.every((s) => s.verdict === worst.verdict);
  const word = worst.outcome.split(" · ")[0] ?? worst.outcome;
  return same ? `${word}, ${resolved.length} sessions` : `${worst.outcome} +${resolved.length - 1}`;
}
