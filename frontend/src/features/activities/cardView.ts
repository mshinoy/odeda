// What one activity card shows, as strings and a picture to draw. Kept apart from the
// component, like `rowView.ts`, so which numbers each sport gets, and which picture sits
// beside them, are tested and the JSX stays a plain layout.
import type { ActivityListItem, Exercise, HrZoneTime } from "@/api/adapters";
import { zoneShares } from "@/charts/hrZones/buildHrZonesOption";
import { sessionTotals, totalVolumeG } from "@/features/activity/gym/gymSession";
import { activityTypeLabel, type ActivityKind } from "@/lib/activityKind";
import {
  formatDateTime,
  formatDecimal,
  formatDistance,
  formatDuration,
  formatElevation,
  formatExerciseName,
  formatHeartRate,
  formatInteger,
  formatSpeed,
  formatSportSpeed,
  formatVolume,
  formatWithUnit,
  MISSING,
  UNLABELLED_EXERCISE,
} from "@/lib/format";
import { maxMuscleLoad, muscleLoad, type MuscleLoad } from "@/lib/muscles";

/** How many exercises a strength card names. */
export const TOP_EXERCISES = 3;

export interface CardStat {
  label: string;
  value: string;
}

/**
 * The picture beside the numbers: the route where there is GPS, the muscles a gym session
 * worked, the HR zones of anything else, or just the sport's colour.
 */
export type CardVisual =
  | { kind: "map" }
  | { kind: "body"; load: MuscleLoad; maxLoad: number }
  | { kind: "zones"; zones: HrZoneTime[] }
  | { kind: "none" };

export interface ActivityCardView {
  id: string;
  href: string;
  name: string;
  /** "Oct 7, 19:14". */
  when: string;
  kind: ActivityKind;
  typeLabel: string;
  race: boolean;
  /** The three or four numbers the sport is judged by, biggest on the card. */
  hero: CardStat[];
  /** Everything else worth a glance, in a quieter line. */
  details: CardStat[];
  /** A strength session's most-worked exercises; empty for anything else. */
  exercises: string[];
  notes: string | null;
  visual: CardVisual;
}

export function toCardView(item: ActivityListItem, today: Date = new Date()): ActivityCardView {
  const typeLabel = activityTypeLabel(item.type);
  return {
    id: item.id,
    href: `/activities/${item.id}`,
    // Garmin names nearly everything; an unnamed activity falls back to its type.
    name: item.name.trim() || typeLabel,
    when: formatDateTime(item.startLocal, today),
    kind: item.kind,
    typeLabel,
    race: item.race,
    hero: present(heroStats(item)),
    details: present(detailStats(item)),
    exercises: isGym(item) ? topExercises(item.exercises) : [],
    notes: item.notes?.trim() || null,
    visual: visualOf(item),
  };
}

function isGym(item: ActivityListItem): boolean {
  return item.totalSets !== null;
}

/** A card leaves out what it does not know: the sports differ, so a dash is only noise. */
function present(stats: CardStat[]): CardStat[] {
  return stats.filter((stat) => stat.value !== MISSING);
}

function stat(label: string, value: string): CardStat {
  return { label, value };
}

// ---------------------------------------------------------------- numbers

function heroStats(item: ActivityListItem): CardStat[] {
  const time = stat("Time", formatDuration(item.movingTimeS ?? item.durationS));
  const hr = stat("Avg HR", formatHeartRate(item.avgHr));
  const distance = stat("Distance", distanceOf(item));
  if (isGym(item)) {
    const { sets, reps } = sessionTotals({
      totalSets: item.totalSets,
      activeSets: null,
      totalReps: item.totalReps,
      exercises: item.exercises,
    });
    return [
      stat("Sets", formatInteger(sets)),
      stat("Reps", formatInteger(reps)),
      time,
      stat("Volume", volumeOf(item.exercises)),
    ];
  }
  switch (item.kind) {
    case "run":
    case "walk":
    case "swim":
      return [distance, time, stat("Pace", speedOf(item)), hr];
    case "ride":
      return [distance, time, stat("Speed", speedOf(item)), hr];
    case "strength":
    case "other":
      return [distance, time, hr, stat("Calories", caloriesOf(item))];
  }
}

function detailStats(item: ActivityListItem): CardStat[] {
  const climb = stat("Climb", climbOf(item));
  const maxHr = stat("Max HR", formatHeartRate(item.maxHr));
  const calories = stat("Calories", caloriesOf(item));
  const effect = stat("Training effect", formatDecimal(item.trainingEffect));
  if (isGym(item)) return [stat("Avg HR", formatHeartRate(item.avgHr)), maxHr, calories, effect];
  switch (item.kind) {
    case "run":
    case "walk":
      return [
        climb,
        maxHr,
        stat("Cadence", formatWithUnit(item.avgCadenceSpm, "spm")),
        calories,
        effect,
      ];
    case "ride":
      return [
        climb,
        stat("Power", formatWithUnit(item.avgPowerW, "W")),
        stat("Max speed", formatSpeed(item.maxSpeedMps)),
        maxHr,
        calories,
        effect,
      ];
    case "swim":
      return [maxHr, calories, effect];
    case "strength":
    case "other":
      return [climb, maxHr, effect];
  }
}

/** Yoga, breathwork and the like record 0 m at 0 m/s: nothing to show, not "0 m". */
function distanceOf(item: ActivityListItem): string {
  return item.distanceM !== null && item.distanceM > 0 ? formatDistance(item.distanceM) : MISSING;
}

function speedOf(item: ActivityListItem): string {
  return distanceOf(item) === MISSING ? MISSING : formatSportSpeed(item.avgSpeedMps, item.kind);
}

/** A flat run's 2 m of climb is GPS noise, not a number worth a place on the card. */
const MIN_CLIMB_M = 10;

function climbOf(item: ActivityListItem): string {
  const gain = item.elevationGainM;
  return gain !== null && gain >= MIN_CLIMB_M ? formatElevation(gain) : MISSING;
}

function caloriesOf(item: ActivityListItem): string {
  return item.calories !== null && item.calories > 0
    ? formatWithUnit(item.calories, "kcal")
    : MISSING;
}

function volumeOf(exercises: readonly Exercise[]): string {
  const volume = totalVolumeG(exercises);
  return volume !== null && volume > 0 ? formatVolume(volume) : MISSING;
}

// ---------------------------------------------------------------- the picture

function visualOf(item: ActivityListItem): CardVisual {
  // The route itself arrives after the card does (`useActivityPreviews`).
  if (item.hasGps) return { kind: "map" };
  if (isGym(item)) {
    const load = muscleLoad(item.exercises);
    const maxLoad = maxMuscleLoad(load);
    // A session of nothing but unlabelled exercises trains no muscle we can name.
    if (maxLoad > 0) return { kind: "body", load, maxLoad };
  }
  if (zoneShares(item.hrZones).length > 0) return { kind: "zones", zones: item.hrZones };
  return { kind: "none" };
}

/**
 * The exercises that took the most sets, named once each. Unlabelled ones are left out:
 * "Unlabelled" says nothing about the session. Ties keep the order they were done in.
 */
export function topExercises(exercises: readonly Exercise[]): string[] {
  const setsByName = new Map<string, number>();
  for (const exercise of exercises) {
    const name = formatExerciseName(exercise.category, exercise.subCategory);
    if (name === UNLABELLED_EXERCISE) continue;
    setsByName.set(name, (setsByName.get(name) ?? 0) + (exercise.sets ?? 0));
  }
  return [...setsByName.entries()]
    .sort(([, a], [, b]) => b - a)
    .slice(0, TOP_EXERCISES)
    .map(([name]) => name);
}
