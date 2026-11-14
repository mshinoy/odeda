import { describe, expect, it } from "vitest";
import { longRunNote, type LongRun } from "@/features/today/longRun";

const short: LongRun = {
  day: "2026-11-06",
  verdict: "short",
  planned_km: 15.5,
  done_km: 11.2,
  shortfall_km: 4.3,
  ride_km: null,
  ride_credit_km: null,
  cost_seconds: 16.8,
  next_day: "2026-11-13",
  next_km: 16,
};

describe("longRunNote", () => {
  it("says what was short, what it costs, and what is next", () => {
    const note = longRunNote(short);
    expect(note.heading).toBe("The long run on Fri Nov 6 was short");
    expect(note.detail).toBe(
      "11.2 of 15.5 km. That costs about 17 s on race day. Next: Fri Nov 13, 16.0 km.",
    );
    expect(note.tone).toBe("warning");
  });

  it("calls a missed one missed, in red, with the whole distance", () => {
    const note = longRunNote({ ...short, verdict: "missed", done_km: 0 });
    expect(note.heading).toBe("The long run on Fri Nov 6 was missed");
    expect(note.detail.startsWith("15.5 km planned.")).toBe(true);
    expect(note.tone).toBe("critical");
  });

  it("leaves out a price it could not work out, and a next run there is not", () => {
    const note = longRunNote({ ...short, cost_seconds: null, next_day: null, next_km: null });
    expect(note.detail).toBe("11.2 of 15.5 km.");
  });

  it("says a ride on the day was a swap, and what it paid off", () => {
    const note = longRunNote({
      ...short,
      day: "2026-11-13",
      verdict: "missed",
      planned_km: 16,
      done_km: 0,
      ride_km: 37.2,
      ride_credit_km: 5.9,
      shortfall_km: 10.1,
      cost_seconds: 49.7,
      next_day: "2026-11-20",
      next_km: 16.5,
    });
    expect(note.heading).toBe("The long run on Fri Nov 13 was swapped for a ride");
    expect(note.detail).toBe(
      "16.0 km planned; the 37.2 km ride counts for about 5.9 km of running. " +
        "That costs about 50 s on race day. Next: Fri Nov 20, 16.5 km.",
    );
    expect(note.tone).toBe("warning");
  });
});
