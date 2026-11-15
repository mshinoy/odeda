// The words on the opening and closing cards, by sport.
import type { ActivitySummary } from "@/api/adapters";
import {
  formatDate,
  formatDistance,
  formatDuration,
  formatHeartRate,
  formatPace,
  formatSpeed,
  formatSwimPace,
} from "@/lib/format";

export interface TitleCard {
  title: string;
  subtitle: string;
}

export interface EndCard {
  title: string;
  stats: { label: string; value: string }[];
}

export function titleCard(summary: ActivitySummary): TitleCard {
  return { title: summary.name, subtitle: formatDate(summary.day) };
}

/** What the closing card sums the activity up with: only what the watch recorded. */
export function endCard(summary: ActivitySummary): EndCard {
  const stats: EndCard["stats"] = [];
  if (summary.distanceM !== null) {
    stats.push({ label: "Distance", value: formatDistance(summary.distanceM) });
  }
  const timeS = summary.movingTimeS ?? summary.durationS;
  if (timeS !== null) stats.push({ label: "Time", value: formatDuration(timeS) });

  const mps = summary.avgSpeedMps;
  if (mps !== null && mps > 0) {
    if (summary.kind === "ride") stats.push({ label: "Avg speed", value: formatSpeed(mps, 1) });
    else if (summary.kind === "swim") stats.push({ label: "Avg pace", value: formatSwimPace(mps) });
    else stats.push({ label: "Avg pace", value: formatPace(1000 / mps) });
  }
  if (summary.avgHr !== null)
    stats.push({ label: "Avg HR", value: formatHeartRate(summary.avgHr) });
  return { title: summary.name, stats };
}
