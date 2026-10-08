// The sentences the training-plan panel says, derived in one place so they are
// testable without mounting anything.
import type { Plan, PlanDecision } from "@/api/queries/usePlan";
import type { AutoSyncStatus } from "@/api/queries/useStatus";
import { formatAgo, formatDate } from "@/lib/format";

type Tone = "good" | "warning" | "serious" | "critical" | "neutral";

export type PlanSyncResult = {
  status: "ok" | "unchanged" | "skipped";
  reason?: string | null;
  sessions?: number;
  withdrawn?: number;
  unsupported?: number;
  parsed_ok?: number;
  parsed_unparsed?: number;
};

/**
 * Whether the feed is working, in a word and a colour.
 *
 * A failing fetch is the state that matters, because the way it fails is specific:
 * Google rotates a calendar's private address when the owner resets it, and from then
 * on the feed 404s forever while everything else in the app looks fine.
 */
export function feedStatus(plan: Plan, now: Date = new Date()): { tone: Tone; text: string } {
  if (!plan.subscribed || !plan.source) {
    return { tone: "neutral", text: "No calendar subscribed. Nothing is prescribed." };
  }
  if (plan.source.last_error) {
    return { tone: "critical", text: plan.source.last_error };
  }
  if (!plan.source.last_fetch_at) {
    return { tone: "warning", text: "Subscribed, but never read. Sync it." };
  }
  return { tone: "good", text: `Read ${formatAgo(plan.source.last_fetch_at, now)}` };
}

/** What a sync did, in the terms the owner cares about: sessions, not HTTP. */
export function planSyncSummary(result: PlanSyncResult): string {
  if (result.status === "skipped") return result.reason ?? "Nothing to sync.";
  if (result.status === "unchanged") return "The calendar has not changed since the last read.";

  const parts = [`${result.sessions ?? 0} sessions read`];
  if (result.withdrawn) parts.push(`${result.withdrawn} withdrawn`);
  if (result.parsed_unparsed) parts.push(`${result.parsed_unparsed} not understood`);
  if (result.unsupported) parts.push(`${result.unsupported} with a repeat rule it cannot expand`);
  return `${parts.join(", ")}.`;
}

/**
 * The parse review list's own line.
 *
 * This is the honesty mechanism for T36: a session the parser dropped is otherwise
 * simply absent from the adherence denominator, and the number silently improves.
 */
export function unreadableLine(plan: Plan): string | null {
  const count = plan.unreadable.length;
  if (count === 0) return null;
  return count === 1
    ? "1 calendar entry could not be read. It is not in any adherence figure."
    : `${count} calendar entries could not be read. They are in no adherence figure.`;
}

/** "Fri 2 Oct · linked by hand to an activity" / "· ignored". */
export function decisionLine(decision: PlanDecision, now: Date = new Date()): string {
  const what =
    decision.link_type === "ignored" ? "ignored" : "linked by hand to a different activity";
  return `${formatDate(decision.day, now)} · ${decision.title ?? "untitled"} · ${what}`;
}

/** The automatic run's view of the plan feed, for the Sync panel's problem list. */
export function planAutoSyncProblem(status: AutoSyncStatus): string | null {
  if (!status.enabled) return null;
  const result = status.sources.plan;
  return result?.state === "error" ? result.message : null;
}
