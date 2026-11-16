import type { BasicsSaved } from "@/api/queries/useBasics";

/** One line for what a save did, so a change to the load numbers is never silent. */
export function savedLine(saved: BasicsSaved): string {
  if (saved.recomputed === 0) return "Saved.";
  const n = saved.recomputed;
  return `Saved. Training load recomputed for ${n} ${n === 1 ? "activity" : "activities"}.`;
}

/** The form's numbers, or the reason they cannot be sent. Blank or fractional is refused. */
export function parseHeartRates(
  rest: string,
  max: string,
): { rest: number; max: number } | { error: string } {
  const r = Number(rest);
  const m = Number(max);
  if (!Number.isInteger(r) || !Number.isInteger(m) || rest.trim() === "" || max.trim() === "") {
    return { error: "Heart rates are whole numbers." };
  }
  return { rest: r, max: m };
}

/** Why a new password cannot be sent yet, or null when it can. */
export function passwordProblem(next: string, confirm: string): string | null {
  if (next.trim().length < 8) return "Use at least 8 characters.";
  if (next !== confirm) return "The two new passwords differ.";
  return null;
}

/** The IANA zones this browser knows, for the picker; empty where it cannot list them. */
export function knownTimeZones(): string[] {
  const intl = Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] };
  try {
    return intl.supportedValuesOf?.("timeZone") ?? [];
  } catch {
    return [];
  }
}

export function browserTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}
