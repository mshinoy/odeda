import { describe, expect, it } from "vitest";
import { taperRows, type Taper } from "@/features/today/taper";

const taper: Taper = {
  peak_km: 36,
  weeks: [
    { start: "2026-12-28", planned_km: 36, pct_of_peak: 100, race_week: false },
    { start: "2027-01-04", planned_km: 30, pct_of_peak: 83, race_week: false },
    { start: "2027-01-11", planned_km: 15.4, pct_of_peak: 43, race_week: true },
  ],
  race_morning_tsb: 4.5,
  race_morning_ctl: 52.1,
  form: "neutral",
  verdict: { level: "good", text: "Form +4 on race morning: neutral." },
};

describe("taperRows", () => {
  it("is a row a week, the last one race week, with its share of the peak", () => {
    const rows = taperRows(taper);
    // The year appears or not with the clock, so the dates are matched without it.
    expect(rows[0]?.label).toMatch(/^Week of Dec 28/);
    expect(rows[1]?.label).toMatch(/^Week of Jan 4/);
    expect(rows[2]?.label).toBe("Race week");
    expect(rows.map((r) => r.km)).toEqual(["36.0 km", "30.0 km", "15.4 km"]);
    expect(rows.map((r) => r.pct)).toEqual([100, 83, 43]);
    expect(rows.map((r) => r.raceWeek)).toEqual([false, false, true]);
  });

  it("keeps a bar inside its track", () => {
    const wide = taperRows({
      ...taper,
      weeks: [{ start: "2027-01-04", planned_km: 80, pct_of_peak: 140, race_week: false }],
    });
    expect(wide[0]?.pct).toBe(100);
  });
});
