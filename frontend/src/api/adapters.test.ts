import { describe, expect, it } from "vitest";
import {
  UNKNOWN_EXERCISE,
  toActivity,
  toActivityStreams,
  toActivitySummary,
  toActivityTrack,
  toGymSession,
} from "@/api/adapters";
import type { components } from "@/api/schema";

type Schemas = components["schemas"];

function row(overrides: Partial<Schemas["ActivityRow"]> = {}): Schemas["ActivityRow"] {
  return {
    activity_id: "a1",
    day: "2026-09-22",
    start_time_local: "2026-09-22T06:10:00",
    start_time_utc: "2026-09-22T03:10:00Z",
    activity_type: "trail_running",
    activity_name: "Morning trail",
    distance_m: 9810,
    duration_s: 2814,
    moving_time_s: 2770,
    avg_hr: 171,
    max_hr: 187,
    avg_speed_mps: 3.54,
    max_speed_mps: 5.1,
    elevation_gain_m: 120,
    calories: 640,
    avg_cadence_spm: 172,
    avg_power_w: null,
    training_effect_aerobic: 4.9,
    training_effect_anaerobic: 2.1,
    trimp: 139,
    raw_id: 7,
    notes: null,
    rpe: null,
    private: 0,
    excluded_from_stats: 1,
    override_count: 2,
    gear_ids: "3,7",
    route_id: 4,
    total_sets: null,
    total_reps: null,
    ...overrides,
  };
}

function rawStreams(
  overrides: Partial<Schemas["ActivityStreams"]> = {},
): Schemas["ActivityStreams"] {
  return {
    activity_id: "a1",
    sample_count: 4,
    elapsed_s: [0, 10, 20, 30],
    distance_m: [0, 30, 60, 60.5],
    hr: [120, 140, null, 150],
    speed_mps: [3, 3, 0.2, null],
    cadence_spm: [170, 172, 0, 171],
    altitude_m: [10, 13, 10, 10],
    lat: [null, 25.1, 25.2, 25.3],
    lon: [null, 51.1, 51.2, 51.3],
    ...overrides,
  };
}

describe("toActivitySummary", () => {
  it("maps names, kind and the SQLite encodings", () => {
    const summary = toActivitySummary(row());
    expect(summary.id).toBe("a1");
    expect(summary.kind).toBe("run");
    expect(summary.gearIds).toEqual([3, 7]);
    expect(summary.isPrivate).toBe(false);
    expect(summary.excludedFromStats).toBe(true);
    expect(summary.edited).toBe(true);
  });

  it("handles missing name and gear", () => {
    const summary = toActivitySummary(
      row({ activity_name: null, gear_ids: null, override_count: 0 }),
    );
    expect(summary.name).toBe("");
    expect(summary.gearIds).toEqual([]);
    expect(summary.edited).toBe(false);
  });

  it("carries the gym totals, null when there are none", () => {
    expect(toActivitySummary(row()).totalSets).toBeNull();
    const gym = toActivitySummary(
      row({ activity_type: "strength_training", total_sets: 14, total_reps: 135 }),
    );
    expect(gym.kind).toBe("strength");
    expect(gym.totalSets).toBe(14);
    expect(gym.totalReps).toBe(135);
  });
});

describe("toGymSession", () => {
  const session = toGymSession({
    total_sets: 4,
    active_sets: 4,
    total_reps: 30,
    exercises: [
      {
        index: 0,
        category: "DEADLIFT",
        sub_category: "ROMANIAN_DEADLIFT",
        sets: 3,
        reps: 24,
        max_weight_g: 60000,
        volume_g: 1440000,
        duration_ms: 95000.5,
      },
      {
        index: 2,
        category: null,
        sub_category: null,
        sets: 1,
        reps: 6,
        max_weight_g: null,
        volume_g: 0,
        duration_ms: null,
      },
    ],
  });

  it("keeps totals, payload index and units (grams, ms)", () => {
    expect(session.totalSets).toBe(4);
    expect(session.activeSets).toBe(4);
    expect(session.totalReps).toBe(30);
    expect(session.exercises[0]).toEqual({
      index: 0,
      category: "DEADLIFT",
      subCategory: "ROMANIAN_DEADLIFT",
      sets: 3,
      reps: 24,
      maxWeightG: 60000,
      volumeG: 1440000,
      durationMs: 95000.5,
    });
    expect(session.exercises[1]?.index).toBe(2);
  });

  it("treats a missing category as Garmin's UNKNOWN", () => {
    expect(session.exercises[1]?.category).toBe(UNKNOWN_EXERCISE);
    expect(session.exercises[1]?.maxWeightG).toBeNull();
  });

  it("is empty for an activity without exercise data", () => {
    const none = toGymSession({
      total_sets: null,
      active_sets: null,
      total_reps: null,
      exercises: [],
    });
    expect(none).toEqual({ totalSets: null, activeSets: null, totalReps: null, exercises: [] });
  });
});

describe("toActivityStreams", () => {
  const streams = toActivityStreams(rawStreams());

  it("keeps every column the same length", () => {
    expect(streams.length).toBe(4);
    for (const column of [
      streams.elapsedS,
      streams.distanceM,
      streams.hr,
      streams.paceSPerKm,
      streams.gradientPct,
      streams.lat,
    ]) {
      expect(column).toHaveLength(4);
    }
  });

  it("derives pace from speed, null when standing still or missing", () => {
    expect(streams.paceSPerKm[0]).toBeCloseTo(1000 / 3);
    expect(streams.paceSPerKm[2]).toBeNull();
    expect(streams.paceSPerKm[3]).toBeNull();
  });

  it("derives percent grade between consecutive samples", () => {
    expect(streams.gradientPct[0]).toBeNull();
    expect(streams.gradientPct[1]).toBeCloseTo(10); // +3 m over 30 m
    expect(streams.gradientPct[2]).toBeCloseTo(-10);
    expect(streams.gradientPct[3]).toBeNull(); // 0.5 m of travel is noise
  });
});

describe("toActivityTrack", () => {
  it("keeps GPS samples only, in [lon, lat] order, with their stream index", () => {
    const track = toActivityTrack(toActivityStreams(rawStreams()));
    expect(track?.line.coordinates).toEqual([
      [51.1, 25.1],
      [51.2, 25.2],
      [51.3, 25.3],
    ]);
    expect(track?.sampleIndex).toEqual([1, 2, 3]);
  });

  it("is null for an indoor activity", () => {
    const indoor = rawStreams({ lat: [null, null, null, null], lon: [null, null, null, null] });
    expect(toActivityTrack(toActivityStreams(indoor))).toBeNull();
  });
});

describe("toActivity", () => {
  it("joins the detail with the streams", () => {
    const detail: Schemas["ActivityDetail"] = {
      activity: row(),
      hr_zones: [{ zone: 3, seconds: 600 }],
      best_efforts: [{ distance_m: 1000, seconds: 250, label: "1 km" }],
      decoupling_pct: 2.5,
      efficiency_factor: 1.242,
      km_splits: [{ km: 1, seconds: 282, avg_hr: 165 }],
      gear: [],
      overrides: [],
      route: { route_id: 4, match_score: 0.93, assigned: "manual", name: "The Pearl loop" },
      has_gps: true,
    };
    const streams = toActivityStreams(rawStreams());
    const activity = toActivity(detail, streams, toActivityTrack(streams));

    expect(activity.summary.name).toBe("Morning trail");
    expect(activity.splits).toEqual([{ km: 1, seconds: 282, avgHr: 165 }]);
    expect(activity.bestEfforts[0]).toEqual({ label: "1 km", distanceM: 1000, seconds: 250 });
    expect(activity.route).toEqual({
      id: 4,
      name: "The Pearl loop",
      matchScore: 0.93,
      manual: true,
    });
    expect(activity.track?.sampleIndex).toEqual([1, 2, 3]);
  });
});
