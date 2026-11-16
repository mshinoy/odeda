import { describe, expect, it } from "vitest";
import type { BasicsSaved } from "@/api/queries/useBasics";
import { parseHeartRates, passwordProblem, savedLine } from "@/features/settings/basicsSummary";

const saved = (recomputed: number): BasicsSaved => ({
  timezone: "Asia/Qatar",
  timezone_default: "Etc/UTC",
  hr_rest: 50,
  hr_max: 190,
  hr_rest_default: 52,
  hr_max_default: 187,
  saved: true,
  recomputed,
});

describe("savedLine", () => {
  it("says nothing moved when no load was recomputed", () => {
    expect(savedLine(saved(0))).toBe("Saved.");
  });
  it("says how many activities moved, singular and plural", () => {
    expect(savedLine(saved(1))).toBe("Saved. Training load recomputed for 1 activity.");
    expect(savedLine(saved(505))).toBe("Saved. Training load recomputed for 505 activities.");
  });
});

describe("parseHeartRates", () => {
  it("reads whole numbers", () => {
    expect(parseHeartRates("52", "187")).toEqual({ rest: 52, max: 187 });
  });
  it("refuses blank and fractional values", () => {
    expect(parseHeartRates("", "187")).toEqual({ error: "Heart rates are whole numbers." });
    expect(parseHeartRates("52.5", "187")).toEqual({ error: "Heart rates are whole numbers." });
  });
});

describe("passwordProblem", () => {
  it("wants eight characters that match", () => {
    expect(passwordProblem("short", "short")).toBe("Use at least 8 characters.");
    expect(passwordProblem("long-enough", "different")).toBe("The two new passwords differ.");
    expect(passwordProblem("long-enough", "long-enough")).toBeNull();
  });
});
