// The sentences the Fitbit panel shows, derived in one place so they are testable
// without mounting anything.
//
// The panel has four states and they are genuinely different problems, so it says
// which one you are in rather than showing a disabled button and leaving you to guess:
// no app registered yet, registered but not authorised, connected with no data, and
// connected with history.
import type { FitbitImportResult, FitbitStatus, FitbitSyncResult } from "@/api/queries/useFitbit";
import { formatInteger, MISSING } from "@/lib/format";

export type FitbitStage = "no_credentials" | "not_connected" | "connected";

export function fitbitStage(status: FitbitStatus): FitbitStage {
  if (!status.credentials_configured) return "no_credentials";
  return status.connected ? "connected" : "not_connected";
}

/** What is stored, in one line. "–" rather than "0 weigh-ins" before the first sync. */
export function storedSummary(status: FitbitStatus): string {
  if (status.weigh_ins === 0) return MISSING;
  const span =
    status.first_day && status.last_day ? ` (${status.first_day} → ${status.last_day})` : "";
  return `${formatInteger(status.weigh_ins)} weigh-ins${span}`;
}

/** Rounded up, and in minutes: the window is an hour, and "in 0 minutes" is a lie. */
function waitInMinutes(seconds: number | null | undefined): string {
  const minutes = Math.max(1, Math.ceil((seconds ?? 3600) / 60));
  return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
}

/**
 * What a finished sync did.
 *
 * A rate-limited run is not a failure and must not read like one: it kept every window
 * it completed and its watermark, so the honest sentence says what it got and when to
 * come back, not "sync failed".
 */
export function syncSummary(result: FitbitSyncResult): string {
  const got = `${formatInteger(result.days_written)} weigh-ins from ${formatInteger(
    result.windows_done,
  )} of ${formatInteger(result.windows)} windows`;

  if (result.state === "rate_limited") {
    return (
      `${got}. Fitbit's hourly budget is spent — run it again in about ` +
      `${waitInMinutes(result.retry_after_s)}; it resumes where it stopped.`
    );
  }
  if (result.state === "stopped") return `${got}. Stopped early.`;
  return `${got}, ${result.start_day} → ${result.end_day}.`;
}

/**
 * What an import did, including which unit the export turned out to be in.
 *
 * The unit is worth saying out loud: it is inferred from each record's own weight and
 * BMI rather than declared anywhere in the file, so the owner should be able to see
 * that the inference agreed with reality.
 */
export function importSummary(result: FitbitImportResult): string {
  const units = result.units_found.length > 0 ? ` (in ${result.units_found.join(" and ")})` : "";
  return (
    `${formatInteger(result.written)} weigh-ins from ${formatInteger(result.members_scanned)}` +
    ` files${units}.`
  );
}
