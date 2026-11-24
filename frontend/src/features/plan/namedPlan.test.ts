import { describe, expect, it } from "vitest";
import {
  activePlanLine,
  activePlanNote,
  activePlanProgress,
  type ActivePlan,
} from "@/features/plan/namedPlan";

const named: ActivePlan = { kind: "named", name: "Higdon Novice 1", week: 5, weeks: 12 };
const calendar: ActivePlan = { kind: "calendar", name: "Training", week: null, weeks: null };

describe("active plan", () => {
  it("names a published plan with its week", () => {
    expect(activePlanLine(named)).toBe("Higdon Novice 1 · week 5 of 12");
    expect(activePlanNote(named)).toBe("its distances are your targets");
  });

  it("falls back to the calendar's own name, with no week", () => {
    expect(activePlanLine(calendar)).toBe("Training");
    expect(activePlanNote(calendar)).toContain("calendar");
  });

  it("has progress only for a published plan, and never outside 0 to 1", () => {
    expect(activePlanProgress(named)).toBeCloseTo(5 / 12);
    expect(activePlanProgress({ ...named, week: 20 })).toBe(1);
    expect(activePlanProgress(calendar)).toBeNull();
  });
});
