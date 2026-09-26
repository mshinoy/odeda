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
  toGearCollection,
  toGymSession,
  toHeatmap,
  toRouteDetail,
  toRouteList,
  toRouteOptions,
  toRouteSegments,
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
    race: 0,
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
        edited: false,
        garmin_category: "DEADLIFT",
        garmin_sub_category: "ROMANIAN_DEADLIFT",
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
        // Relabelled by the user: Garmin had no idea what it was.
        edited: true,
        garmin_category: null,
        garmin_sub_category: null,
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
      edited: false,
      garminCategory: "DEADLIFT",
      garminSubCategory: "ROMANIAN_DEADLIFT",
    });
    expect(session.exercises[1]?.index).toBe(2);
  });

  it("treats a missing category as Garmin's UNKNOWN", () => {
    expect(session.exercises[1]?.category).toBe(UNKNOWN_EXERCISE);
    expect(session.exercises[1]?.maxWeightG).toBeNull();
    // Relabelled, and Garmin's missing category reads as unlabelled too.
    expect(session.exercises[1]?.edited).toBe(true);
    expect(session.exercises[1]?.garminCategory).toBe(UNKNOWN_EXERCISE);
    expect(session.exercises[1]?.garminSubCategory).toBeNull();
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

  it("reads the retired flag as a boolean, and keeps the mileage beside it", () => {
    const collection = toGearCollection({
      gear: [item, { ...item, gear_id: 4, retired: 1 }],
      defaults: [
        {
          activity_type: "running",
          gear_id: 3,
          kind: "shoe",
          brand: "Asics",
          model: "Novablast 4",
          nickname: null,
          display_name: "Asics Novablast 4",
        },
      ],
      kinds: ["shoe", "bike"],
    });

    expect(collection.gear.map((g) => [g.id, g.name, g.retired])).toEqual([
      [3, "Asics Novablast 4", false],
      [4, "Asics Novablast 4", true],
    ]);
    expect(collection.gear[0]?.totalDistanceM).toBe(item.total_distance_m);
    expect(collection.gear[0]?.state).toBe("ok");
    expect(collection.defaults).toEqual([
      { activityType: "running", gearId: 3, name: "Asics Novablast 4", kind: "shoe" },
    ]);
    expect(collection.kinds).toEqual(["shoe", "bike"]);
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
    expect(toRouteOptions({ routes: [routeSummary()] })).toEqual([
      {
        id: 12,
        name: "Corniche out and back",
        activityType: "running",
        distanceM: 10120.5,
        attempts: 23,
      },
    ]);
  });

  it("gives the route list how the route has gone, on top of that", () => {
    expect(toRouteList({ routes: [routeSummary()] })).toEqual([
      {
        id: 12,
        name: "Corniche out and back",
        activityType: "running",
        distanceM: 10120.5,
        attempts: 23,
        kind: "run",
        isLoop: false,
        pinned: true,
        bestTimeS: 2890.0,
        medianTimeS: 3050.0,
        firstDay: "2025-01-04",
        lastDay: "2026-09-20",
      },
    ]);
  });

  it("keeps the API's order, which is busiest first", () => {
    const rows = toRouteList({
      routes: [routeSummary({ route_id: 1, attempts: 9 }), routeSummary({ route_id: 2 })],
    });
    expect(rows.map((r) => r.id)).toEqual([1, 2]);
  });
});

function routeSummary(overrides: Partial<Schemas["RouteSummary"]> = {}): Schemas["RouteSummary"] {
  return {
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
    median_moving_time_s: 3050.0,
    avg_hr: 158.0,
    distance_km: 10.12,
    ...overrides,
  };
}

describe("toHeatmap", () => {
  it("zips the three columns into one object per cell, lon before lat", () => {
    expect(
      toHeatmap({
        precision: 4,
        cells: 2,
        max_count: 426,
        lat: [25.2979, 25.3015],
        lon: [51.4975, 51.4944],
        count: [426, 420],
      }),
    ).toEqual({
      precision: 4,
      maxCount: 426,
      cells: [
        { lon: 51.4975, lat: 25.2979, count: 426 },
        { lon: 51.4944, lat: 25.3015, count: 420 },
      ],
    });
  });

  it("gives an empty grid no cells", () => {
    const empty = { precision: 4, cells: 0, max_count: 0, lat: [], lon: [], count: [] };
    expect(toHeatmap(empty).cells).toEqual([]);
  });

  it("drops a cell whose columns do not line up rather than inventing a coordinate", () => {
    const ragged = {
      precision: 4,
      cells: 2,
      max_count: 5,
      lat: [25.3],
      lon: [51.5],
      count: [5, 3],
    };
    expect(toHeatmap(ragged).cells).toEqual([{ lon: 51.5, lat: 25.3, count: 5 }]);
  });
});

describe("toRouteDetail", () => {
  function detail(overrides: Partial<Schemas["RouteDetail"]> = {}): Schemas["RouteDetail"] {
    return {
      route: {
        route_id: 31,
        name: "5.0 km loop #31",
        activity_type: "running",
        distance_m: 5071.3,
        distance_km: 5.07,
        elevation_gain_m: 29.7,
        is_loop: true,
        pinned: false,
        start_lat: 25.301,
        start_lon: 51.495,
        end_lat: 25.301,
        end_lon: 51.495,
        centroid_lat: 25.299,
        centroid_lon: 51.495,
        created_at: "2026-09-23T12:01:12Z",
        updated_at: "2026-09-24T07:46:39Z",
        points: {
          lat: [25.3, 25.31],
          lon: [51.49, 51.5],
          altitude_m: [12.0, null],
          distance_m: [0, 1200],
        },
      },
      attempts: [attempt("old", "2024-01-18"), attempt("best", "2026-09-15")],
      attempt_count: 2,
      counted_count: 2,
      stats: {
        best_time_s: 1722.9,
        worst_time_s: 3344,
        median_time_s: 2526.6,
        avg_pace_s_per_km: 506.7,
        best_pace_s_per_km: 447.2,
        improvement_s: -662.9,
        first_day: "2024-01-18",
        last_day: "2026-09-15",
      },
      best_attempt: attempt("best", "2026-09-15"),
      worst_attempt: attempt("old", "2024-01-18"),
      ...overrides,
    };
  }

  function attempt(id: string, day: string): Schemas["RouteAttempt"] {
    return {
      activity_id: id,
      day,
      start_time_local: `${day}T06:10:00`,
      activity_name: "Doha Running",
      distance_m: 5047.7,
      moving_time_s: 2499.9,
      duration_s: 2500.9,
      avg_hr: 145,
      max_hr: 165,
      avg_speed_mps: 2.018,
      elevation_gain_m: 29.7,
      avg_cadence_spm: 144.2,
      rpe: null,
      excluded_from_stats: null,
      match_score: 0.96,
      assigned: "auto",
    };
  }

  it("turns the columnar polyline into [lon, lat] points", () => {
    expect(toRouteDetail(detail()).route.path).toEqual([
      [51.49, 25.3],
      [51.5, 25.31],
    ]);
  });

  it("keeps the API's units and names the fastest attempt", () => {
    const result = toRouteDetail(detail());
    expect(result.route.kind).toBe("run");
    expect(result.stats).toEqual({
      bestTimeS: 1722.9,
      medianTimeS: 2526.6,
      worstTimeS: 3344,
      improvementS: -662.9,
      firstDay: "2024-01-18",
      lastDay: "2026-09-15",
    });
    expect(result.bestActivityId).toBe("best");
  });

  it("reads a null excluded_from_stats as not excluded", () => {
    expect(toRouteDetail(detail()).attempts.every((a) => !a.excluded)).toBe(true);
  });

  it("has no best attempt for a route whose attempts are all untimed", () => {
    expect(toRouteDetail(detail({ best_attempt: null })).bestActivityId).toBeNull();
  });
});

describe("toRouteSegments", () => {
  function segment(
    overrides: Partial<Schemas["RouteSegmentProfile"]> = {},
  ): Schemas["RouteSegmentProfile"] {
    return {
      seg_index: 0,
      start_m: 0,
      end_m: 200,
      attempts: 63,
      median_speed_mps: 2.1868,
      median_pace_s_per_km: 457.3,
      fastest_speed_mps: 2.8985,
      slowest_speed_mps: 0.2285,
      speed_cv_pct: 20.75,
      relative_speed: 1.046,
      median_hr: 104.6,
      median_cadence_spm: 71.7,
      median_gradient_pct: -2.75,
      median_seconds: 94,
      path: { lat: [25.3, 25.31], lon: [51.49, 51.5] },
      ...overrides,
    };
  }

  it("keeps the units and turns each path into [lon, lat] points", () => {
    expect(
      toRouteSegments({
        route_id: 31,
        name: "x",
        segment_m: 200,
        attempts: 63,
        segments: [segment()],
        fastest_segments: [],
        slowest_segments: [],
      }),
    ).toEqual([
      {
        index: 0,
        startM: 0,
        endM: 200,
        attempts: 63,
        relativeSpeed: 1.046,
        medianSpeedMps: 2.1868,
        medianHr: 104.6,
        medianSeconds: 94,
        medianGradientPct: -2.75,
        path: [
          [51.49, 25.3],
          [51.5, 25.31],
        ],
      },
    ]);
  });

  it("drops a stretch the polyline cannot draw, rather than sending deck.gl a point", () => {
    const rows = toRouteSegments({
      route_id: 31,
      name: "x",
      segment_m: 500,
      attempts: 1,
      segments: [segment({ seg_index: 1, path: { lat: [25.3], lon: [51.49] } }), segment()],
      fastest_segments: [],
      slowest_segments: [],
    });
    expect(rows.map((r) => r.index)).toEqual([0]);
  });
});
