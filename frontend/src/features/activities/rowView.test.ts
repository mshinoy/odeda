import { describe, expect, it } from "vitest";
import type { ActivitySummary } from "@/api/adapters";
import { toRowView } from "@/features/activities/rowView";

const today = new Date(2026, 8, 24);

const run: ActivitySummary = {
  id: "101",
  name: "Morning run",
  type: "running",
  kind: "run",
  day: "2026-09-22",
  startLocal: "2026-09-22T07:15:00",
  distanceM: 10_020,
  durationS: 3000,
  movingTimeS: 2950,
  avgHr: 148.6,
  maxHr: 171,
  // 1000 / 3.4 = 294.1 s/km -> 4:54 /km
  avgSpeedMps: 3.4,
  elevationGainM: 42,
  calories: 610,
  trimp: 88,
  trainingEffect: 3.1,
  avgCadenceSpm: 125,
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
};

describe("toRowView", () => {
  it("formats a run: date, name, type, distance, sport-aware pace, moving time, HR", () => {
    expect(toRowView(run, today)).toEqual({
      id: "101",
      href: "/activities/101",
      date: "Sep 22",
      name: "Morning run",
      race: false,
      kind: "run",
      typeLabel: "Running",
      measure: { kind: "distance", distance: "10.0 km", pace: "4:54 /km" },
      time: "49:10",
      hr: "149 bpm",
    });
  });

  it("uses the sport's unit for pace", () => {
    const ride = { ...run, type: "cycling", kind: "ride" as const, avgSpeedMps: 8 };
    expect(toRowView(ride, today).measure).toMatchObject({ pace: "28.8 km/h" });
    const swim = { ...run, type: "lap_swimming", kind: "swim" as const, avgSpeedMps: 0.8 };
    expect(toRowView(swim, today).measure).toMatchObject({ pace: "2:05 /100m" });
  });

  it("shows sets and reps for a gym session, in place of distance and pace", () => {
    const gym = {
      ...run,
      type: "strength_training",
      kind: "strength" as const,
      distanceM: 0,
      avgSpeedMps: 0,
      totalSets: 14,
      totalReps: 135,
    };
    expect(toRowView(gym, today).measure).toEqual({
      kind: "gym",
      setsReps: "14 sets · 135 reps",
    });
  });

  it("treats any activity with a set count as a gym session, whatever its type", () => {
    const hiit = { ...run, type: "other", kind: "other" as const, totalSets: 8, totalReps: null };
    expect(toRowView(hiit, today).measure).toEqual({ kind: "gym", setsReps: "8 sets" });
  });

  it("shows no distance or pace for an activity that recorded 0 m", () => {
    const yoga = { ...run, type: "other", kind: "other" as const, distanceM: 0, avgSpeedMps: 0 };
    expect(toRowView(yoga, today).measure).toEqual({
      kind: "distance",
      distance: "–",
      pace: "–",
    });
  });

  it("falls back to the type for an unnamed activity, and to duration without moving time", () => {
    const view = toRowView({ ...run, name: " ", movingTimeS: null }, today);
    expect(view.name).toBe("Running");
    expect(view.time).toBe("50:00");
  });

  it("adds the year to dates outside the current one", () => {
    expect(toRowView({ ...run, day: "2025-12-30" }, today).date).toBe("Dec 30, 2025");
  });
});
