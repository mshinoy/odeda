import { describe, expect, it } from "vitest";
import {
  UNKNOWN_EXERCISE,
  toActivity,
  toActivityGear,
  toActivityStreams,
  toActivitySummary,
  toActivityTrack,
  toEditableFields,
  toEditableValues,
  toGearItems,
  toGymSession,
  toRouteOptions,
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

  it("smooths speed over ~30 s and derives pace from the smoothed speed", () => {
    // Samples 10 s apart, so the 30 s window reaches one neighbour on each side:
    // [2, 4, 2, 4] → [(2+4)/2, (2+4+2)/3, (4+2+4)/3, (2+4)/2].
    const smoothed = toActivityStreams(rawStreams({ speed_mps: [2, 4, 2, 4] }));
    expect(smoothed.speedMps).toEqual([2, 4, 2, 4]);
    expect(smoothed.smoothSpeedMps[0]).toBeCloseTo(3);
    expect(smoothed.smoothSpeedMps[1]).toBeCloseTo(8 / 3);
    expect(smoothed.smoothSpeedMps[2]).toBeCloseTo(10 / 3);
    expect(smoothed.paceSPerKm[1]).toBeCloseTo(375);
  });

  it("leaves stops out of the smoothed speed", () => {
    // 0.2 m/s is standing still: a gap, and not part of its neighbours' means.
    expect(streams.smoothSpeedMps).toEqual([3, 3, null, null]);
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

describe("editing", () => {
  const fields = toEditableFields({
    activity_types: ["running"],
    fields: [
      {
        name: "activity_name",
        type: "text",
        label: "Title",
        editor: "text",
        choices: null,
        min: null,
        max: null,
        user_only: false,
        help: "",
      },
      {
        name: "rpe",
        type: "int",
        label: "RPE",
        editor: "number",
        choices: null,
        min: 1,
        max: 10,
        user_only: true,
        help: "",
      },
      {
        name: "private",
        type: "bool",
        label: "Private",
        editor: "bool",
        choices: null,
        min: null,
        max: null,
        user_only: true,
        help: "",
      },
      {
        name: "excluded_from_stats",
        type: "bool",
        label: "Exclude",
        editor: "bool",
        choices: null,
        min: null,
        max: null,
        user_only: true,
        help: "",
      },
      {
        name: "future_field",
        type: "text",
        label: "New",
        editor: "text",
        choices: null,
        min: null,
        max: null,
        user_only: true,
        help: "",
      },
    ],
  });

  it("keeps each field's editor, bounds and choices (none as an empty list)", () => {
    expect(fields[1]).toEqual({
      userOnly: true,
      name: "rpe",
      label: "RPE",
      type: "int",
      editor: "number",
      choices: [],
      min: 1,
      max: 10,
    });
  });

  it("reads each field's value from the row by its own name, bools as booleans", () => {
    const values = toEditableValues(
      row({ activity_name: "Doha Running", rpe: 7, private: 1, excluded_from_stats: null }),
      fields,
    );
    expect(values).toEqual({
      activity_name: "Doha Running",
      rpe: 7,
      private: true,
      excluded_from_stats: false,
      // A field the row doesn't carry yet is empty, not an error.
      future_field: null,
    });
  });
});

describe("gear and routes", () => {
  const item: Schemas["GearItem"] = {
    gear_id: 3,
    kind: "shoe",
    brand: "Asics",
    model: "Novablast 4",
    nickname: null,
    purchase_date: "2025-04-02",
    initial_distance_m: 0,
    retirement_distance_m: 800000,
    retired: 0,
    notes: null,
    photo_path: null,
    source: "manual",
    garmin_uuid: null,
    created_at: "2025-04-02T10:00:00Z",
    updated_at: "2025-04-02T10:00:00Z",
    display_name: "Asics Novablast 4",
    activity_count: 61,
    tracked_distance_m: 512340.0,
    total_distance_m: 512340.0,
    total_distance_km: 512.34,
    moving_time_s: 180000,
    elevation_gain_m: 2100,
    first_use: "2025-04-05",
    last_use: "2026-09-20",
    retirement_pct: 64.0,
    remaining_m: 287660.0,
    state: "ok",
    distance_per_week_km: 7.1,
  };

  it("keeps only what a select needs, and reads the retired flag as a boolean", () => {
    expect(
      toGearItems({ gear: [item, { ...item, gear_id: 4, retired: 1 }], defaults: [], kinds: [] }),
    ).toEqual([
      { id: 3, kind: "shoe", name: "Asics Novablast 4", retired: false },
      { id: 4, kind: "shoe", name: "Asics Novablast 4", retired: true },
    ]);
  });

  it("reads an activity's gear the same way", () => {
    const worn: Schemas["ActivityGear"] = {
      gear_id: 3,
      kind: "shoe",
      brand: "Asics",
      model: "Novablast 4",
      nickname: "Novas",
      purchase_date: null,
      initial_distance_m: 0,
      retirement_distance_m: null,
      retired: 0,
      notes: null,
      photo_path: null,
      source: "garmin",
      garmin_uuid: "u1",
      created_at: "2025-04-02T10:00:00Z",
      updated_at: "2025-04-02T10:00:00Z",
      assign_source: "garmin",
      assigned_at: "2025-04-05T06:00:00Z",
      display_name: "Novas",
    };
    expect(toActivityGear([worn])).toEqual([
      { id: 3, kind: "shoe", name: "Novas", retired: false },
    ]);
  });

  it("keeps only what a route select needs", () => {
    const route: Schemas["RouteSummary"] = {
      route_id: 12,
      name: "Corniche out and back",
      activity_type: "running",
      distance_m: 10120.5,
      is_loop: false,
      pinned: true,
      start_lat: 25.29,
      start_lon: 51.53,
      centroid_lat: 25.3,
      centroid_lon: 51.54,
      elevation_gain_m: 34.0,
      created_at: "2025-01-01T00:00:00Z",
      updated_at: "2026-09-20T00:00:00Z",
      attempts: 23,
      first_day: "2025-01-04",
      last_day: "2026-09-20",
      avg_moving_time_s: 3140.0,
      best_moving_time_s: 2890.0,
      avg_hr: 158.0,
      distance_km: 10.12,
    };
    expect(toRouteOptions({ routes: [route] })).toEqual([
      {
        id: 12,
        name: "Corniche out and back",
        activityType: "running",
        distanceM: 10120.5,
        attempts: 23,
      },
    ]);
  });
});
