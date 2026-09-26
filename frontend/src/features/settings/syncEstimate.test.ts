import { describe, expect, it } from "vitest";
import type { SyncEstimate } from "@/api/queries/useSettings";
import { estimateFacts, formatEstimateRange } from "@/features/settings/syncEstimate";

function estimate(patch: Partial<SyncEstimate> = {}): SyncEstimate {
  return {
    first_day: "2022-12-27",
    last_day: "2026-09-26",
    days: 1370,
    activities_pending_details: 0,
    daily_endpoints: 6,
    estimated_requests: 8220,
    estimated_seconds_low: 4932,
    estimated_seconds_high: 12330,
    ...patch,
  };
}

describe("formatEstimateRange", () => {
  it("shows both ends, because the backend cannot promise one", () => {
    // 4,932 s = 1.37 h; 12,330 s = 3.43 h.
    expect(formatEstimateRange(estimate())).toBe("1.4 h – 3.4 h");
  });

  it("collapses to one value when the two ends round the same", () => {
    expect(
      formatEstimateRange(estimate({ estimated_seconds_low: 120, estimated_seconds_high: 140 })),
    ).toBe("2 min");
  });
});

describe("estimateFacts", () => {
  it("reports the history as a range and the rest as counts", () => {
    const facts = estimateFacts(estimate({ activities_pending_details: 12 }));

    expect(facts.map((f) => f.label)).toEqual(["History", "Days", "Requests", "Streams to fetch"]);
    expect(facts[1]?.value).toBe("1,370");
    expect(facts[3]?.value).toBe("12");
  });
});
