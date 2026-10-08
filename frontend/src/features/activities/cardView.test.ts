import { describe, expect, it } from "vitest";
import type { ActivityListItem, Exercise } from "@/api/adapters";
import { toCardView, topExercises } from "@/features/activities/cardView";

const today = new Date(2026, 9, 8);

const run: ActivityListItem = {
  id: "101",
  name: "Morning run",
  type: "running",
  kind: "run",
  day: "2026-10-06",
  startLocal: "2026-10-06T07:15:00",
  distanceM: 10_020,
  durationS: 3000,
  movingTimeS: 2950,
  avgHr: 148.6,
  maxHr: 171,
  // 1000 / 3.4 = 294.1 s/km -> 4:54 /km
  avgSpeedMps: 3.4,
  maxSpeedMps: 4.9,
  elevationGainM: 42,
  calories: 610,
  trimp: 88,
  trainingEffect: 3.1,
  rpe: null,
  notes: null,
  routeId: null,
  gearIds: [],
  isPrivate: false,
  excludedFromStats: false,
  race: false,
  edited: false,
  totalSets: null,
  totalReps: null,
  avgPowerW: null,
  avgCadenceSpm: 172,
  hasGps: true,
  hrZones: [
    { zone: 1, seconds: 300 },
    { zone: 2, seconds: 2400 },
  ],
  exercises: [],
};

function exercise(category: string, sets: number, extra: Partial<Exercise> = {}): Exercise {
  return {
    index: 0,
    category,
    subCategory: null,
    sets,
    reps: sets * 8,
    maxWeightG: 40_000,
    volumeG: sets * 8 * 40_000,
    durationMs: null,
    edited: false,
    garminCategory: category,
    garminSubCategory: null,
    ...extra,
  };
}

const gym: ActivityListItem = {
  ...run,
  id: "202",
  name: "Upper body",
  type: "strength_training",
  kind: "strength",
  distanceM: 0,
  avgSpeedMps: 0,
  elevationGainM: null,
  avgCadenceSpm: null,
  hasGps: false,
  totalSets: 9,
  totalReps: 72,
  exercises: [exercise("BENCH_PRESS", 4), exercise("ROW", 3), exercise("UNKNOWN", 2)],
};

describe("toCardView", () => {
  it("gives a run its distance, time, pace and HR, and the rest in the details", () => {
    const view = toCardView(run, today);
    expect(view).toMatchObject({
      id: "101",
      href: "/activities/101",
      name: "Morning run",
      when: "Oct 6, 07:15",
      kind: "run",
      typeLabel: "Running",
      hero: [
        { label: "Distance", value: "10.0 km" },
        { label: "Time", value: "49:10" },
        { label: "Pace", value: "4:54 /km" },
        { label: "Avg HR", value: "149 bpm" },
      ],
      details: [
        { label: "Climb", value: "42 m" },
        { label: "Max HR", value: "171 bpm" },
        { label: "Cadence", value: "172 spm" },
        { label: "Calories", value: "610 kcal" },
        { label: "Training effect", value: "3.1" },
      ],
      exercises: [],
      visual: { kind: "map" },
    });
  });

  it("gives a ride speed, power and max speed", () => {
    const ride = { ...run, type: "cycling", kind: "ride" as const, avgSpeedMps: 6, avgPowerW: 180 };
    const view = toCardView(ride, today);
    expect(view.hero[2]).toEqual({ label: "Speed", value: "21.6 km/h" });
    expect(view.details.map((s) => s.label)).toEqual([
      "Climb",
      "Power",
      "Max speed",
      "Max HR",
      "Calories",
      "Training effect",
    ]);
  });

  it("gives a swim its pace per 100 m", () => {
    const swim = { ...run, type: "lap_swimming", kind: "swim" as const, avgSpeedMps: 0.8 };
    expect(toCardView(swim, today).hero[2]).toEqual({ label: "Pace", value: "2:05 /100m" });
  });

  it("leaves out what it does not know, instead of showing a dash", () => {
    const sparse = {
      ...run,
      avgHr: null,
      maxHr: null,
      calories: null,
      trainingEffect: null,
      avgCadenceSpm: null,
      elevationGainM: 3,
    };
    const view = toCardView(sparse, today);
    expect(view.hero.map((s) => s.label)).toEqual(["Distance", "Time", "Pace"]);
    expect(view.details).toEqual([]);
  });

  it("gives a gym session sets, reps, time and volume, and its body diagram", () => {
    const view = toCardView(gym, today);
    expect(view.hero).toEqual([
      { label: "Sets", value: "9" },
      { label: "Reps", value: "72" },
      { label: "Time", value: "49:10" },
      { label: "Volume", value: "2,880 kg" },
    ]);
    expect(view.exercises).toEqual(["Bench press", "Row"]);
    expect(view.visual.kind).toBe("body");
  });

  it("falls back to HR zones when a gym session trained nothing it can name", () => {
    const unlabelled = { ...gym, exercises: [exercise("UNKNOWN", 5)] };
    expect(toCardView(unlabelled, today).visual).toEqual({ kind: "zones", zones: run.hrZones });
  });

  it("shows HR zones for an indoor activity, and nothing when there are none", () => {
    const indoor = { ...run, type: "treadmill_running", hasGps: false };
    expect(toCardView(indoor, today).visual.kind).toBe("zones");
    expect(toCardView({ ...indoor, hrZones: [] }, today).visual).toEqual({ kind: "none" });
  });

  it("names an unnamed activity after its type and keeps notes only when there are some", () => {
    expect(toCardView({ ...run, name: "  " }, today).name).toBe("Running");
    expect(toCardView({ ...run, notes: "  " }, today).notes).toBeNull();
    expect(toCardView({ ...run, notes: "Felt easy" }, today).notes).toBe("Felt easy");
  });
});

describe("topExercises", () => {
  it("names the exercises with the most sets first, each once, at most three", () => {
    const exercises = [
      exercise("CURL", 2),
      exercise("SQUAT", 5),
      exercise("BENCH_PRESS", 3),
      exercise("CURL", 2),
      exercise("ROW", 1),
    ];
    expect(topExercises(exercises)).toEqual(["Squat", "Curl", "Bench press"]);
  });

  it("names the variant when Garmin gives one", () => {
    const rdl = exercise("DEADLIFT", 3, { subCategory: "ROMANIAN_DEADLIFT" });
    expect(topExercises([rdl])).toEqual(["Romanian deadlift"]);
  });
});
