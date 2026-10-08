// The sentences the Fitbit panel shows, derived in one place so they are testable
// without mounting anything.
//
// The panel has four states and they are genuinely different problems, so it says
// which one you are in rather than showing a disabled button and leaving you to guess:
// no app registered yet, registered but not authorised, connected with no data, and
// connected with history.
import type { FitbitImportResult, FitbitStatus, FitbitSyncResult } from "@/api/queries/useFitbit";
import { formatAgo, formatDate, formatIn, formatInteger, MISSING } from "@/lib/format";

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

/** Rounded up, and in minutes: Google's budget resets per minute, and "in 0 minutes" is a lie. */
function waitInMinutes(seconds: number | null | undefined): string {
  const minutes = Math.max(1, Math.ceil((seconds ?? 60) / 60));
  return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
}

/**
 * What a finished sync did.
 *
 * A rate-limited run is not a failure and must not read like one: it kept everything it
 * fetched and its watermark, so the honest sentence says what it got and when to come
 * back, not "sync failed".
 */
export function syncSummary(result: FitbitSyncResult): string {
  const got = `${formatInteger(result.days_written)} weigh-ins from ${formatInteger(
    result.weight_points,
  )} weight and ${formatInteger(result.body_fat_points)} body-fat readings`;

  if (result.state === "rate_limited") {
    return (
      `${got}. Google's per-minute budget is spent — run it again in about ` +
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

const DAY_MS = 86_400_000;

export interface SigninNotice {
  tone: "neutral" | "warning" | "critical";
  text: string;
  /** Expiring or expired: the reconnect steps open on their own. */
  urgent: boolean;
}

/**
 * When Google ends the sign-in (D9: an app in Testing is signed out 7 days after
 * consent), said plainly enough that the weekly reconnect happens before a sync fails.
 * Null when there is nothing to say: not connected, or a sign-in from before the date
 * was recorded.
 */
export function signinNotice(status: FitbitStatus, now: Date = new Date()): SigninNotice | null {
  const iso = status.signin_expires_at;
  if (!status.connected || !iso) return null;
  const left = new Date(iso).getTime() - now.getTime();
  if (Number.isNaN(left)) return null;
  if (left <= 0) {
    return {
      tone: "critical",
      text: `Google ended the sign-in ${formatAgo(iso, now)}. Reconnect to bring weigh-ins back.`,
      urgent: true,
    };
  }
  if (left < DAY_MS) {
    return {
      tone: "warning",
      text: `Google ends the sign-in ${formatIn(iso, now)}. Reconnect now and weigh-ins never stop.`,
      urgent: true,
    };
  }
  return {
    tone: "neutral",
    text: `Sign-in lasts 7 days while the Google app is in Testing — renew by ${formatDate(iso, now)} (${formatIn(iso, now)}).`,
    urgent: false,
  };
}
