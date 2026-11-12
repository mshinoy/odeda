// The activity's kilometres as rows of bars, longer is faster. On foot every kilometre; on
// a bike every five, because one kilometre at 30 km/h is two minutes and says little.
import type { Split } from "@/api/adapters";
import type { ActivityKind } from "@/lib/activityKind";
import { formatKmh, formatPaceClock } from "@/lib/format";

export interface KilometreRow {
  label: string;
  value: string;
  /** The bar's length, 25 to 100: the slowest still shows, the fastest fills the row. */
  widthPct: number;
}

export interface Kilometres {
  /** What a row covers, for the panel's title. */
  unit: "km" | "5 km";
  rows: KilometreRow[];
  /** "Fastest: kilometre 1 (8:20). Slowest: kilometre 6 (10:25)." */
  summary: string | null;
}

const BIKE_BLOCK_KM = 5;
const MIN_WIDTH = 25;

interface Block {
  label: string;
  /** Kilometres per second, so a bigger number is faster whatever the unit. */
  speed: number;
  value: string;
}

function foot(splits: readonly Split[]): Block[] {
  return splits
    .filter((s) => s.seconds > 0)
    .map((s) => ({ label: String(s.km), speed: 1 / s.seconds, value: formatPaceClock(s.seconds) }));
}

function bike(splits: readonly Split[]): Block[] {
  const timed = splits.filter((s) => s.seconds > 0);
  const blocks: Block[] = [];
  for (let i = 0; i < timed.length; i += BIKE_BLOCK_KM) {
    const chunk = timed.slice(i, i + BIKE_BLOCK_KM);
    const seconds = chunk.reduce((sum, s) => sum + s.seconds, 0);
    const first = chunk[0]?.km ?? i + 1;
    const last = chunk[chunk.length - 1]?.km ?? first;
    blocks.push({
      label: first === last ? String(first) : `${first}–${last}`,
      speed: chunk.length / seconds,
      value: formatKmh((chunk.length * 3600) / seconds),
    });
  }
  return blocks;
}

export function kilometres(splits: readonly Split[], kind: ActivityKind): Kilometres {
  const onBike = kind === "ride";
  const blocks = kind === "run" || kind === "walk" ? foot(splits) : onBike ? bike(splits) : [];
  if (blocks.length < 2) return { unit: onBike ? "5 km" : "km", rows: [], summary: null };

  const speeds = blocks.map((b) => b.speed);
  const slow = Math.min(...speeds);
  const fast = Math.max(...speeds);
  const rows = blocks.map((b) => ({
    label: b.label,
    value: b.value,
    widthPct:
      fast === slow
        ? 100
        : Math.round(MIN_WIDTH + ((100 - MIN_WIDTH) * (b.speed - slow)) / (fast - slow)),
  }));

  const quickest = blocks.find((b) => b.speed === fast);
  const slowest = blocks.find((b) => b.speed === slow);
  const noun = onBike ? "km" : "kilometre";
  const summary =
    quickest && slowest && fast !== slow
      ? `Fastest: ${noun} ${quickest.label} (${quickest.value}). Slowest: ${noun} ${slowest.label} (${slowest.value}).`
      : null;
  return { unit: onBike ? "5 km" : "km", rows, summary };
}
