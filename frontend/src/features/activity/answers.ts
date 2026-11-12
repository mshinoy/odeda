// The three questions a finished activity is asked: did it do what the plan wanted, how did
// it compare with the last times on this route, and how hard was it? Each answer is worked
// out here from data the page already has, so the cards hold no logic and the wording is
// tested on its own.
import type { HrZoneTime, RouteAttempt } from "@/api/adapters";
import type { ActivityPlan } from "@/api/queries/useActivityPlan";
import type { Performance } from "@/api/queries/usePerformance";
import { sessionLabel, VERDICT_DISPLAY } from "@/features/plan/planView";
import {
  formatDate,
  formatDecimal,
  formatDistance,
  formatDuration,
  formatHeartRate,
  formatInteger,
  formatWeekday,
} from "@/lib/format";

export type Tone = "good" | "warning" | "serious" | "critical" | "neutral";

export interface Pill {
  text: string;
  tone: Tone;
}

// ---------------------------------------------------------------- the plan

export interface PlanAnswer {
  /** "Against the plan · Long run". */
  label: string;
  pill: Pill;
  /** "11.2 of 15.0 km", or the session's own title when it had no distance. */
  big: string;
  detail: string;
  /** Share done of the biggest the plan asked, and where the plan's minimum sits on it. */
  bar: { fraction: number; marker: number | null } | null;
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** How the activity went against the session the plan prescribed; null when none was. */
export function planAnswer(plan: ActivityPlan | undefined): PlanAnswer | null {
  const session = plan?.session;
  if (!plan || !session) return null;

  const min = session.planned_min_m;
  const max = session.planned_max_m ?? min;
  const actual = session.actual_m;
  const verdict = VERDICT_DISPLAY[session.verdict];
  const kind = session.kind ? capitalise(sessionLabel(session)) : null;

  const measured = min !== null && actual !== null && max !== null && max > 0;
  const big = measured
    ? `${formatDecimal(actual / 1000)} of ${formatDecimal(min / 1000)} km`
    : session.title.trim();
  const asked =
    min === null
      ? `Planned for ${formatWeekday(session.day)} ${formatDate(session.day)}.`
      : max !== null && max !== min
        ? `The plan asked ${formatDistance(min)} to ${formatDistance(max)}.`
        : `The plan asked ${formatDistance(min)}.`;
  const moved = session.moved_from ? ` Moved from ${formatDate(session.moved_from)}.` : "";
  const next = plan.next
    ? ` Next: ${formatWeekday(plan.next.day)} ${formatDate(plan.next.day)}${
        plan.next.planned_min_m ? `, ${formatDistance(plan.next.planned_min_m)}` : ""
      }.`
    : "";

  return {
    label: kind ? `Against the plan · ${kind}` : "Against the plan",
    pill: { text: verdict.label, tone: verdict.tone },
    big,
    detail: `${asked}${moved}${next}`,
    bar: measured
      ? {
          fraction: Math.min(actual / max, 1),
          marker: max !== min && min !== null ? min / max : null,
        }
      : null,
  };
}

// ---------------------------------------------------------------- the route

export interface RouteDot {
  label: string;
  time: string;
  current: boolean;
}

export interface RouteAnswer {
  /** "On this route · 3rd time". */
  label: string;
  pill: Pill;
  /** "4:56 faster", or "First on this route". */
  big: string;
  dots: RouteDot[];
}

/** Attempts this far from the activity's own distance are another outing, not the same one. */
const SAME_ROUTE_TOLERANCE = 0.15;
const MAX_DOTS = 4;

export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/**
 * How this attempt did against the others on its route. A route can hold laps and a short
 * warm-up, so only attempts of about the same length are compared: a two-lap session is
 * not slower than a one-lap one. Null with fewer than two to compare.
 */
export function routeAnswer(
  attempts: readonly RouteAttempt[],
  activityId: string,
  distanceM: number | null,
): RouteAnswer | null {
  if (distanceM === null || distanceM <= 0) return null;
  const comparable = attempts
    .filter(
      (a) =>
        !a.excluded &&
        a.movingTimeS !== null &&
        a.distanceM !== null &&
        Math.abs(a.distanceM - distanceM) / distanceM <= SAME_ROUTE_TOLERANCE,
    )
    .sort((a, b) => (a.startLocal ?? a.day).localeCompare(b.startLocal ?? b.day));
  const index = comparable.findIndex((a) => a.activityId === activityId);
  const mine = comparable[index];
  if (index < 0 || mine === undefined || mine.movingTimeS === null || comparable.length < 2) {
    return null;
  }

  const myTime = mine.movingTimeS;
  const rank = 1 + comparable.filter((a) => (a.movingTimeS ?? Infinity) < myTime).length;
  const previous = comparable[index - 1];
  let big = "First on this route";
  if (previous?.movingTimeS != null) {
    const delta = previous.movingTimeS - myTime;
    big =
      delta === 0
        ? "Same as last time"
        : `${formatDuration(Math.abs(delta))} ${delta > 0 ? "faster" : "slower"}`;
  }

  const start = Math.max(0, Math.min(index - 1, comparable.length - MAX_DOTS));
  return {
    label: `On this route · ${ordinal(index + 1)} time`,
    pill:
      rank === 1
        ? { text: `Fastest of ${comparable.length}`, tone: "good" }
        : { text: `${ordinal(rank)} fastest of ${comparable.length}`, tone: "neutral" },
    big,
    dots: comparable.slice(start, start + MAX_DOTS).map((a) => ({
      label: formatDate(a.day),
      time: formatDuration(a.movingTimeS),
      current: a.activityId === activityId,
    })),
  };
}

// ---------------------------------------------------------------- the effort

export interface EffortAnswer {
  label: string;
  /** "TRIMP 142", or null without one. */
  pill: Pill | null;
  /** "Easy aerobic", "Steady" or "Hard". */
  big: string;
  /** The share of the time in each zone, 1 to 5, summing to 1. */
  zones: number[];
  detail: string;
}

/** Rules of thumb: most of the time in Zones 1 and 2 is easy; a fifth in 4 and 5 is hard. */
const EASY_SHARE = 0.8;
const HARD_SHARE = 0.2;

export function effortAnswer(
  zones: readonly HrZoneTime[],
  trimp: number | null,
  avgHr: number | null,
  maxHr: number | null,
): EffortAnswer | null {
  const seconds = [1, 2, 3, 4, 5].map((z) => zones.find((x) => x.zone === z)?.seconds ?? 0);
  const total = seconds.reduce((a, b) => a + b, 0);
  if (total <= 0) return null;
  const shares = seconds.map((s) => s / total);

  const easy = (shares[0] ?? 0) + (shares[1] ?? 0);
  const hard = (shares[3] ?? 0) + (shares[4] ?? 0);
  const big = hard >= HARD_SHARE ? "Hard" : easy >= EASY_SHARE ? "Easy aerobic" : "Steady";

  const ranked = shares
    .map((share, i) => ({ zone: i + 1, share }))
    .filter((z) => z.share >= 0.05)
    .sort((a, b) => b.share - a.share)
    .slice(0, 2);
  const where = ranked.map((z) => `${Math.round(z.share * 100)}% in Zone ${z.zone}`).join(", ");
  const heart =
    avgHr === null
      ? ""
      : ` Average ${formatHeartRate(avgHr)}${maxHr === null ? "" : `, highest ${formatInteger(maxHr)}`}.`;

  return {
    label: "Effort",
    pill: trimp === null ? null : { text: `TRIMP ${formatInteger(trimp)}`, tone: "neutral" },
    big,
    zones: shares,
    detail: `${where}.${heart}`,
  };
}

// ---------------------------------------------------------------- records

/** The distances this activity holds the best effort for, as the records call them. */
export function newBests(performance: Performance | undefined, activityId: string): string[] {
  return (
    performance?.personal_bests
      .filter((best) => best.activity_id === activityId)
      .map((best) => best.label) ?? []
  );
}
