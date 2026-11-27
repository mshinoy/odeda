// The sentences the Sync panel says about the automatic sync, derived in one place so
// they are testable without mounting anything.
import type { AutoSyncStatus } from "@/api/queries/useStatus";
import { formatAgo, formatIn } from "@/lib/format";

const SOURCE_LABELS = {
  garmin: "Garmin",
  fitbit: "Google Health",
  plan: "Training plan",
} as const;

/** 6 → "6 hours", 1 → "hour", 0.5 → "30 minutes". */
function every(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)} minutes`;
  if (hours === 1) return "hour";
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} hours`;
}

/** One line: whether it syncs on its own, when it last did and when it will next. */
export function autoSyncLine(status: AutoSyncStatus, now: Date = new Date()): string {
  if (!status.enabled) return "Automatic sync is off (GA_AUTO_SYNC_HOURS=0).";
  if (status.running) return "Syncing on its own now…";
  const head = `Syncs on its own every ${every(status.interval_hours)}`;
  const next = formatIn(status.next_run_at, now);
  const when = next === "now" ? "next run due now" : `next ${next}`;
  if (!status.finished_at) return `${head} · ${when}.`;
  return `${head} · last ran ${formatAgo(status.finished_at, now)} · ${when}.`;
}

/**
 * Each source the last run failed on, with what it said — the remedy is in the message.
 * Nothing when automatic sync is off: an old run's failure is not a problem to act on.
 */
export function autoSyncProblems(status: AutoSyncStatus): { source: string; message: string }[] {
  if (!status.enabled) return [];
  // The plan is the third source (T39) and its failure is the one with a remedy the
  // owner has to act on: Google rotates the secret address whenever it is reset.
  return (["garmin", "fitbit", "plan"] as const).flatMap((key) => {
    const result = status.sources[key];
    return result?.state === "error"
      ? [{ source: SOURCE_LABELS[key], message: result.message }]
      : [];
  });
}

/** Runs in a row a source must fail before the whole app says so: one is a blip. */
export const FAILING_RUNS = 2;

export type SyncAlert = { title: string; detail: string };

/**
 * What the banner above every page says, or null when nothing needs the owner.
 *
 * A lapsed Garmin login is told at once, since nothing but signing in again fixes it and
 * every run until then fails. Any other source is told only once it has failed
 * `FAILING_RUNS` runs in a row (about twelve hours at the default), so a bad minute at
 * Garmin does not put a banner on every page.
 */
export function syncAlert(
  status: AutoSyncStatus | undefined,
  now: Date = new Date(),
): SyncAlert | null {
  if (!status?.enabled) return null;
  const labelled = (["garmin", "fitbit", "plan"] as const).flatMap((key) => {
    const result = status.sources[key];
    return result?.state === "error" ? [{ key, label: SOURCE_LABELS[key], result }] : [];
  });
  const lapsed = labelled.find((s) => s.result.needs_signin);
  if (lapsed) {
    return {
      title: `${lapsed.label} needs you to sign in again`,
      detail: `Your data has stopped updating since ${formatAgo(lapsed.result.failing_since, now)}. Sign in under Settings.`,
    };
  }
  const failing = labelled.find((s) => s.result.failures >= FAILING_RUNS);
  if (!failing) return null;
  const { result, label } = failing;
  return {
    title: `${label} has failed to sync ${result.failures} times in a row`,
    detail: `${result.message} It has not worked since ${formatAgo(result.failing_since, now)}.`,
  };
}
