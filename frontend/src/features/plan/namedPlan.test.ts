import { describe, expect, it } from "vitest";
import { namedPlanLine, namedPlanProgress } from "@/features/plan/namedPlan";

const plan = { name: "Higdon Novice 1", week: 5, weeks: 12 };

describe("named plan", () => {
  it("reads as the plan and the week", () => {
    expect(namedPlanLine(plan)).toBe("Higdon Novice 1 · week 5 of 12");
  });

  it("measures progress through the plan, and never outside 0 to 1", () => {
    expect(namedPlanProgress(plan)).toBeCloseTo(5 / 12);
    expect(namedPlanProgress({ ...plan, week: 20 })).toBe(1);
    expect(namedPlanProgress({ ...plan, weeks: 0 })).toBe(0);
  });
});
