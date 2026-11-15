import { describe, expect, it } from "vitest";
import type { PlanSession, SteerRisk } from "@/api/queries/usePlan";
import {
  keySessionLine,
  raceLine,
  riskText,
  standingLine,
  standingTitle,
  standingTone,
} from "@/features/plan/steerView";

const longRun = (verdict: PlanSession["verdict"]): PlanSession => ({
  day: "2026-11-13",
  sport: "running",
  kind: "long",
  planned_min_m: 8000,
  planned_max_m: 8000,
  title: "Long Run",
  optional: false,
  ignored: false,
  session_ids: [1],
  verdict,
  activity_id: null,
  actual_sport: null,
  actual_m: null,
  actual_s: null,
  moved_from: null,
  edited: false,
  own: false,
  original_day: null,
});

describe("standing", () => {
  it("names every standing, and falls back for an unknown one", () => {
    expect(standingTitle("on_track")).toBe("On track");
    expect(standingTitle("well_behind")).toBe("Well behind the plan");
    expect(standingTitle("nonsense")).toBe("Not enough to judge yet");
  });

  it("tones behind as a warning and well behind as the only red", () => {
    expect(standingTone("behind")).toBe("warning");
    expect(standingTone("well_behind")).toBe("critical");
    expect(standingTone("ahead")).toBe("good");
  });

  it("says what it is measured on", () => {
    expect(standingLine({ standing: "behind", km_done_pct: 34 })).toContain("34%");
    expect(standingLine({ standing: "unknown", km_done_pct: null })).toContain("no running");
  });
});

describe("raceLine", () => {
  it("counts the days and weeks", () => {
    const line = raceLine({
      name: "Doha Half",
      date: "2027-01-15",
      days_to_go: 61,
      weeks_to_go: 8.7,
    });
    expect(line).toBe("Doha Half: 61 days to go · 8.7 weeks");
  });

  it("is null with no race ahead", () => {
    expect(raceLine(null)).toBeNull();
  });
});

describe("riskText", () => {
  it("tells a missed long run from a cut short one, and never says double up", () => {
    const missed: SteerRisk = {
      code: "long_run_cut",
      severity: 2,
      day: "2026-11-13",
      verdict: "missed",
    };
    const short: SteerRisk = { ...missed, verdict: "short" };
    expect(riskText(missed)).toContain("was missed");
    expect(riskText(short)).toContain("was cut short");
    expect(riskText(missed)).toContain("do not double up");
  });

  it("gives the kilometre share for low volume and the count for a streak", () => {
    expect(riskText({ code: "volume_low", severity: 3, km_done_pct: 34 })).toContain("34%");
    expect(riskText({ code: "missed_streak", severity: 1, count: 3 })).toContain("3 runs missed");
  });
});

describe("keySessionLine", () => {
  it("shows the verdict once the day has passed, not before", () => {
    expect(keySessionLine(longRun("missed"))).toContain("Missed");
    expect(keySessionLine(longRun("missed"))).toMatch(/^Long run/);
    expect(keySessionLine(longRun("upcoming"))).not.toContain(":");
  });

  it("is null without a long run", () => {
    expect(keySessionLine(null)).toBeNull();
  });
});
