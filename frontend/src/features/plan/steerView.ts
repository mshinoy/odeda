// The steering answer in words. The backend returns facts and stable codes; this is the
// only place they become sentences, so the wording is tested and changed in one spot.
import type { PlanSession, PlanSteer, SteerRisk } from "@/api/queries/usePlan";
import { sessionLabel, VERDICT_DISPLAY } from "@/features/plan/planView";
import { formatDate, formatDistance, formatPercent, formatWeekday } from "@/lib/format";

const STANDING_TITLE: Record<string, string> = {
  ahead: "Ahead of the plan",
  on_track: "On track",
  behind: "Behind the plan",
  well_behind: "Well behind the plan",
  unknown: "Not enough to judge yet",
};

export type StandingTone = "good" | "warning" | "critical" | "neutral";

const STANDING_TONE: Record<string, StandingTone> = {
  ahead: "good",
  on_track: "good",
  behind: "warning",
  well_behind: "critical",
  unknown: "neutral",
};

export function standingTitle(standing: string): string {
  return STANDING_TITLE[standing] ?? "Not enough to judge yet";
}

export function standingTone(standing: string): StandingTone {
  return STANDING_TONE[standing] ?? "neutral";
}

/** What the standing is measured on, in one sentence. */
export function standingLine(steer: Pick<PlanSteer, "standing" | "km_done_pct">): string {
  if (steer.km_done_pct === null) return "The plan asked for no running over the last four weeks.";
  return `You ran ${formatPercent(steer.km_done_pct)} of the plan's kilometres over the last four weeks.`;
}

/** "61 days to go · 8.7 weeks", or null when no race is ahead. */
export function raceLine(race: PlanSteer["race"]): string | null {
  if (race === null || race.days_to_go === null) return null;
  const days = race.days_to_go === 1 ? "1 day" : `${race.days_to_go} days`;
  const weeks = race.weeks_to_go === null ? "" : ` · ${race.weeks_to_go} weeks`;
  return `${race.name}: ${days} to go${weeks}`;
}

/** The one line of advice for a risk. Never a scolding: what to do next. */
export function riskText(risk: SteerRisk): string {
  switch (risk.code) {
    case "volume_low":
      return `Only ${formatPercent(risk.km_done_pct ?? null)} of the planned kilometres in four weeks, and fitness falls at that pace. Do this week's runs as written before adding anything.`;
    case "long_run_cut": {
      const what = risk.verdict === "short" ? "was cut short" : "was missed";
      const when = risk.day ? `on ${formatWeekday(risk.day)} ${formatDate(risk.day)}` : "recently";
      return `The long run ${when} ${what}. Do the next one as written; do not double up.`;
    }
    case "missed_streak":
      return `${risk.count ?? "Several"} runs missed in the last week. The next easy run is the one to get back to.`;
    default:
      return "Something in the plan needs a look.";
  }
}

/** "Long run · Fri 13 Nov · 8.0 km: Missed", or null with no long run in the plan. */
export function keySessionLine(session: PlanSession | null): string | null {
  if (session === null) return null;
  const parts = [sessionLabel(session), `${formatWeekday(session.day)} ${formatDate(session.day)}`];
  if (session.planned_min_m) parts.push(formatDistance(session.planned_min_m));
  const verdict = VERDICT_DISPLAY[session.verdict];
  const ahead = session.verdict === "upcoming";
  return `${parts.join(" · ")}${ahead ? "" : `: ${verdict.label}`}`;
}
