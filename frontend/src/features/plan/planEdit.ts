// What the change-a-session form sends. Pure, so a typed "6,5" or "abc" is decided here
// and tested, not discovered in a request that comes back 422.

/** Kilometres typed by the owner, as metres. Empty means "leave the distance alone". */
export function parseKm(text: string): { metres: number | null } | { error: string } {
  const trimmed = text.trim().replace(",", ".");
  if (trimmed === "") return { metres: null };
  const km = Number(trimmed);
  if (!Number.isFinite(km) || km <= 0 || km > 500) {
    return { error: "A distance in kilometres, such as 6.5." };
  }
  return { metres: Math.round(km * 1000) };
}

/** The sports a session of one's own can be, in the words the page uses. */
export const OWN_SPORTS = [
  { value: "running", label: "Run" },
  { value: "cycling", label: "Ride" },
  { value: "strength", label: "Gym" },
  { value: "swimming", label: "Swim" },
  { value: "walking", label: "Walk" },
] as const;

/** The seven days of the week starting `start` (a Monday), as `YYYY-MM-DD`. */
export function weekDays(start: string): string[] {
  return Array.from({ length: 7 }, (_, offset) => {
    const date = new Date(`${start}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + offset);
    return date.toISOString().slice(0, 10);
  });
}
