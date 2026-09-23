import { describe, expect, it } from "vitest";
import { activityKind, activityTypeLabel } from "@/lib/activityKind";

describe("activityKind", () => {
  it.each([
    ["running", "run"],
    ["trail_running", "run"],
    ["treadmill_running", "run"],
    ["track_running", "run"],
    ["cycling", "ride"],
    ["road_biking", "ride"],
    ["mountain_biking", "ride"],
    ["indoor_cycling", "ride"],
    ["virtual_ride", "ride"],
    ["gravel_cycling", "ride"],
    ["lap_swimming", "swim"],
    ["open_water_swimming", "swim"],
    ["swimming", "swim"],
    ["walking", "walk"],
    ["hiking", "walk"],
    ["strength_training", "strength"],
  ] as const)("maps known type %s to %s", (type, kind) => {
    expect(activityKind(type)).toBe(kind);
  });

  it.each([
    ["some_new_running_mode", "run"],
    ["fat_biking", "ride"],
    ["handcycling", "ride"],
    ["e_ride_thing", "ride"],
    ["pool_swim_drill", "swim"],
    ["nordic_walking", "walk"],
    ["mountain_hike", "walk"],
  ] as const)("falls back on the substring in %s → %s", (type, kind) => {
    expect(activityKind(type)).toBe(kind);
  });

  it("is case- and whitespace-insensitive", () => {
    expect(activityKind("  Trail_Running ")).toBe("run");
  });

  it.each(["yoga", "rowing", "", "unknown"])("returns other for %j", (type) => {
    expect(activityKind(type)).toBe("other");
  });
});

describe("activityTypeLabel", () => {
  it("turns underscores into spaces in sentence case", () => {
    expect(activityTypeLabel("trail_running")).toBe("Trail running");
    expect(activityTypeLabel("open_water_swimming")).toBe("Open water swimming");
    expect(activityTypeLabel("running")).toBe("Running");
  });

  it("normalises case and stray underscores", () => {
    expect(activityTypeLabel("STRENGTH__training_")).toBe("Strength training");
  });

  it("returns an empty string for an empty type", () => {
    expect(activityTypeLabel("")).toBe("");
  });
});
