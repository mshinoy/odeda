import { describe, expect, it } from "vitest";
import type { PlanUploadSummary } from "@/api/queries/usePlan";
import { nextMonday, previewLines } from "@/features/plan/uploadView";

const summary = (over: Partial<PlanUploadSummary> = {}): PlanUploadSummary => ({
  status: "preview",
  format: "csv",
  effective_day: "2026-11-23",
  sessions: 4,
  skipped_before: 0,
  first_day: "2026-11-23",
  last_day: "2027-01-15",
  replaced: 302,
  own_removed: 0,
  race: null,
  race_lost: false,
  past_kept: 370,
  ...over,
});

describe("nextMonday", () => {
  it("is the Monday after a Sunday, a Wednesday and a Monday", () => {
    expect(nextMonday("2026-11-15")).toBe("2026-11-16"); // Sunday
    expect(nextMonday("2026-11-11")).toBe("2026-11-16"); // Wednesday
    expect(nextMonday("2026-11-16")).toBe("2026-11-23"); // Monday: a week on, not today
  });

  it("crosses a month end", () => {
    expect(nextMonday("2026-11-29")).toBe("2026-11-30");
    expect(nextMonday("2026-12-30")).toBe("2027-01-04");
  });
});

describe("previewLines", () => {
  const texts = (p: PlanUploadSummary) => previewLines(p).map((l) => l.text);

  it("says what is added, what stops, and that earlier weeks are kept", () => {
    const lines = texts(summary());
    expect(lines[0]).toContain("Adds 4 sessions");
    expect(lines.some((l) => l.startsWith("Stops 302 sessions"))).toBe(true);
    expect(lines.some((l) => l.includes("keep the plan they were judged against"))).toBe(true);
  });

  it("mentions the owner's own sessions only when some would stop", () => {
    expect(texts(summary()).join(" ")).not.toContain("you added");
    expect(texts(summary({ own_removed: 2 })).join(" ")).toContain("2 sessions you added");
  });

  it("warns, as a warning, when the race would be lost", () => {
    const lines = previewLines(summary({ race_lost: true }));
    const warning = lines.find((l) => l.warning);
    expect(warning?.text).toContain("RACE:");
  });

  it("names the race when the file has it", () => {
    const lines = texts(summary({ race: { name: "Doha Half", date: "2027-01-15" } }));
    expect(lines.some((l) => l.startsWith("Race in the file: Doha Half"))).toBe(true);
  });

  it("says when sessions before the day were left out, and uses the singular", () => {
    expect(texts(summary({ skipped_before: 1 })).join(" ")).toContain("1 session in the file");
    expect(texts(summary({ sessions: 1 }))[0]).toContain("Adds 1 session,");
  });
});
