import { describe, expect, it } from "vitest";
import { parseKm, weekDays } from "@/features/plan/planEdit";

describe("parseKm", () => {
  it("reads kilometres as metres, with a comma or a point", () => {
    expect(parseKm("6.5")).toEqual({ metres: 6500 });
    expect(parseKm("6,5")).toEqual({ metres: 6500 });
    expect(parseKm(" 12 ")).toEqual({ metres: 12000 });
  });

  it("treats empty as leaving the distance alone", () => {
    expect(parseKm("")).toEqual({ metres: null });
    expect(parseKm("  ")).toEqual({ metres: null });
  });

  it("refuses what is not a sensible distance", () => {
    expect(parseKm("abc")).toHaveProperty("error");
    expect(parseKm("0")).toHaveProperty("error");
    expect(parseKm("-3")).toHaveProperty("error");
    expect(parseKm("900")).toHaveProperty("error");
  });
});

describe("weekDays", () => {
  it("is the seven days from the Monday", () => {
    const days = weekDays("2026-11-09");
    expect(days).toHaveLength(7);
    expect(days[0]).toBe("2026-11-09");
    expect(days[6]).toBe("2026-11-15");
  });

  it("crosses a month end", () => {
    expect(weekDays("2026-11-30")[1]).toBe("2026-12-01");
  });
});
