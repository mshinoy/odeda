import { describe, expect, it } from "vitest";
import type { components } from "@/api/schema";
import { adjustmentNote, finishRange, morningForm, verdictShort } from "@/features/status/forecast";

type TimeRange = components["schemas"]["TimeRange"];
type FormForecast = components["schemas"]["FormForecast"];

const time: TimeRange = {
  distance_m: 21097.5,
  raw: { fast: 6400, central: 6600, slow: 6900 },
  adjusted: { fast: 6360, central: 6550, slow: 6840 },
  central_pace_s_per_km: 310,
  fitness_pct: -0.8,
  form_pct: -1,
  ctl_race: 50,
  tsb_race: 9,
  basis: "followed",
  sources: [],
  widened: false,
  caveats: [],
};

describe("finishRange", () => {
  it("reads fast to slow, then the likeliest finish and its pace", () => {
    const out = finishRange(time);
    expect(out.range).toBe("1:46:00 – 1:54:00");
    expect(out.detail).toBe("most likely 1:49:10 · 5:10 /km");
  });
});

describe("adjustmentNote", () => {
  it("names each rule that moved the time", () => {
    expect(adjustmentNote(time)).toBe(
      "Adjusted for fitness −0.8% and race-morning form −1.0% on the time.",
    );
  });
  it("says nothing when neither did", () => {
    expect(adjustmentNote({ ...time, fitness_pct: 0, form_pct: 0 })).toBeNull();
  });
});

describe("morningForm", () => {
  const form = {
    basis: "followed",
    race_morning: { tsb: 12, tsb_followed: 7 },
  } as unknown as FormForecast;
  it("follows the basis the verdict judged", () => {
    expect(morningForm(form)).toBe(7);
    expect(morningForm({ ...form, basis: "plan" })).toBe(12);
  });
});

describe("verdictShort", () => {
  const base = {
    basis: "followed",
    curve: [{ ctl: 40, ctl_followed: 30 }],
    race_morning: { ctl: 52, ctl_followed: 18 },
  };
  it("says the two fitness figures when fitness is set to fall", () => {
    const form = {
      ...base,
      verdict: {
        level: "warning",
        text: "Form +6 on race morning, but fitness falls from 30 to 18: x",
      },
    } as unknown as FormForecast;
    expect(verdictShort(form)).toBe("Fitness falls 30 → 18");
  });
  it("otherwise keeps what follows the colon", () => {
    const form = {
      ...base,
      verdict: { level: "good", text: "Form +12 on race morning: in the fresh window." },
    } as unknown as FormForecast;
    expect(verdictShort(form)).toBe("in the fresh window.");
  });
});
