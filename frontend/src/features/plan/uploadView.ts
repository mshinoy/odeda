// What the upload preview says, in words. Pure, so the warning about a lost race and the
// "earlier weeks keep the old plan" line are tested rather than hoped for.
import type { PlanUploadSummary } from "@/api/queries/usePlan";
import { formatDate } from "@/lib/format";

/** The next Monday strictly after `today` (a Monday gives the one a week on). */
export function nextMonday(today: string): string {
  const date = new Date(`${today}T00:00:00Z`);
  const ahead = (8 - date.getUTCDay()) % 7 || 7;
  date.setUTCDate(date.getUTCDate() + ahead);
  return date.toISOString().slice(0, 10);
}

export interface PreviewLine {
  text: string;
  /** A warning is the one thing the owner should not click past. */
  warning?: boolean;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function previewLines(p: PlanUploadSummary): PreviewLine[] {
  const lines: PreviewLine[] = [
    {
      text: `Adds ${plural(p.sessions, "session", "sessions")}, ${formatDate(p.first_day)} to ${formatDate(p.last_day)}.`,
    },
  ];
  if (p.replaced > 0 || p.own_removed > 0) {
    const own =
      p.own_removed > 0 ? `, and ${plural(p.own_removed, "session", "sessions")} you added` : "";
    lines.push({
      text: `Stops ${plural(p.replaced, "session", "sessions")} of the current plan from ${formatDate(p.effective_day)}${own}.`,
    });
  }
  lines.push({
    text: `Earlier weeks (${plural(p.past_kept, "session", "sessions")}) keep the plan they were judged against.`,
  });
  if (p.skipped_before > 0) {
    lines.push({
      text: `${plural(p.skipped_before, "session", "sessions")} in the file fall before ${formatDate(p.effective_day)} and are left out.`,
    });
  }
  if (p.race_lost) {
    lines.push({
      text: "This plan has no race on the day your current one does, so the race countdown and forecast would go. Add a line starting RACE: to the file first.",
      warning: true,
    });
  } else if (p.race) {
    lines.push({ text: `Race in the file: ${p.race.name}, ${formatDate(p.race.date)}.` });
  }
  return lines;
}
