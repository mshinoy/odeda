import { describe, expect, it } from "vitest";
import type { SetupStatus } from "@/api/queries/useBasics";
import { firstRunSteps, showFirstRun } from "@/features/today/firstRun";

const setup = (over: Partial<SetupStatus> = {}): SetupStatus => ({
  activities: 0,
  garmin_connected: false,
  basics_saved: false,
  password_set: false,
  ...over,
});

describe("showFirstRun", () => {
  it("shows on an empty install and not before the answer arrives", () => {
    expect(showFirstRun(undefined)).toBe(false);
    expect(showFirstRun(setup())).toBe(true);
  });
  it("is gone once there is any activity", () => {
    expect(showFirstRun(setup({ activities: 1 }))).toBe(false);
  });
});

describe("firstRunSteps", () => {
  it("lists basics, Garmin, sync and the password, in that order", () => {
    expect(firstRunSteps(setup()).map((s) => s.key)).toEqual([
      "basics",
      "garmin",
      "sync",
      "password",
    ]);
  });
  it("ticks what is done and drops the password step when one is set", () => {
    const steps = firstRunSteps(
      setup({ basics_saved: true, garmin_connected: true, password_set: true }),
    );
    expect(steps.map((s) => [s.key, s.done])).toEqual([
      ["basics", true],
      ["garmin", true],
      ["sync", false],
    ]);
  });
});
