// The pacing plan as the page and the wristband text show it. Pure, so the table holds no
// logic and the rules for what a row says are tested without rendering anything.
import type { RacePacing } from "@/api/queries/usePlan";
import { formatDuration, formatPaceClock } from "@/lib/format";

export interface PacingRow {
  /** "1" to "21", then "21.1" for the last, partial kilometre. */
  km: string;
  split: string;
  total: string;
  pace: string;
  /** What to know about this kilometre: the start, a turn, a mark, the finish. */
  note: string | null;
}

const MARKS: Readonly<Record<number, string>> = { 10: "10 km", 15: "15 km", 20: "20 km" };

/**
 * One row a kilometre. A turn goes on the kilometre it falls in, because that is the one
 * to run knowing it is coming; the first kilometre says to hold back, and the last is the
 * finish.
 */
export function pacingRows(plan: RacePacing): PacingRow[] {
  const turnNotes = new Map<number, string[]>();
  for (const turn of plan.course.turns) {
    const index = Math.floor(turn.km) + 1;
    const label = turn.kind === "turnaround" ? "U-turn" : "Turn";
    turnNotes.set(index, [...(turnNotes.get(index) ?? []), `${label} at ${turn.km.toFixed(1)} km`]);
  }

  return plan.splits.map((split, i) => {
    const last = i === plan.splits.length - 1;
    const notes: string[] = [];
    if (split.km === 1) notes.push("Start: hold back a little");
    notes.push(...(turnNotes.get(split.km) ?? []));
    const mark = MARKS[split.km];
    if (mark !== undefined) notes.push(mark);
    if (last) notes.push("Finish");
    return {
      km: last && split.distance_m < 1000 ? "21.1" : String(split.km),
      split: formatDuration(split.split_s),
      total: formatDuration(split.cum_s),
      pace: formatPaceClock(split.pace_s_per_km),
      note: notes.length === 0 ? null : notes.join(" · "),
    };
  });
}

/**
 * A target time typed as `h:mm:ss`, `h:mm` or `mm:ss`-looking `3:30`, read as hours and
 * minutes: nobody runs a half marathon in three and a half minutes. Null for anything
 * else, or for a time outside what a half marathon could take.
 */
export function parseTarget(text: string): number | null {
  const parts = text.trim().split(":");
  if (parts.length < 2 || parts.length > 3) return null;
  const numbers = parts.map((part) => (/^\d{1,2}$/.test(part) ? Number(part) : NaN));
  if (numbers.some(Number.isNaN)) return null;
  const [h = 0, m = 0, s = 0] = numbers;
  if (m > 59 || s > 59) return null;
  const seconds = h * 3600 + m * 60 + s;
  return seconds >= 1800 && seconds <= 36000 ? seconds : null;
}

/** The plan as plain text, to paste into a note or onto a pace band. */
export function pacingText(plan: RacePacing): string {
  const rows = pacingRows(plan);
  const lines = rows.map(
    (row) =>
      `${row.km.padStart(4)}  ${row.split.padStart(5)}  ${row.total.padStart(7)}${row.note ? `  ${row.note}` : ""}`,
  );
  const head = plan.race ? `${plan.race.name}, ${plan.race.date}` : "Race";
  const target = plan.target_s === null ? "" : `, target ${formatDuration(plan.target_s)}`;
  return [`${head}${target}`, "  km  split    total", ...lines].join("\n");
}
