import { describe, expect, it } from "vitest";
import type { AutoSyncStatus } from "@/api/queries/useStatus";
import { autoSyncLine, autoSyncProblems } from "@/features/settings/autoSyncSummary";

// Built from local components, like a browser clock; the server's stamps are UTC
// instants, so they are built the same way to keep the test zone-independent.
const now = new Date(2026, 9, 8, 12, 0, 0);
const at = (hours: number) => new Date(now.getTime() + hours * 3_600_000).toISOString();

const ran: AutoSyncStatus = {
  enabled: true,
  interval_hours: 6,
  running: false,
  state: "done",
  message: "1 new activity. 2 weigh-ins through 2026-10-08.",
  started_at: at(-2.1),
  finished_at: at(-2),
  next_run_at: at(4),
  sources: {
    garmin: { state: "done", message: "1 new activity." },
    fitbit: { state: "done", message: "2 weigh-ins through 2026-10-08." },
  },
};

describe("autoSyncLine", () => {
  it("says how often, when it last ran and when it runs next", () => {
    expect(autoSyncLine(ran, now)).toBe(
      "Syncs on its own every 6 hours · last ran 2 h ago · next in 4 h.",
    );
  });

  it("before the first run", () => {
    const fresh = {
      ...ran,
      state: null,
      finished_at: null,
      started_at: null,
      next_run_at: at(0.03),
    };
    expect(autoSyncLine(fresh, now)).toBe("Syncs on its own every 6 hours · next in 2 min.");
  });

  it("an overdue run waiting on a manual sync is due now, not in the past", () => {
    expect(autoSyncLine({ ...ran, next_run_at: at(-0.5) }, now)).toBe(
      "Syncs on its own every 6 hours · last ran 2 h ago · next run due now.",
    );
  });

  it("while running, and when off", () => {
    expect(autoSyncLine({ ...ran, running: true }, now)).toBe("Syncing on its own now…");
    expect(
      autoSyncLine({ ...ran, enabled: false, interval_hours: 0, next_run_at: null }, now),
    ).toBe("Automatic sync is off (GA_AUTO_SYNC_HOURS=0).");
  });

  it("names short and fractional intervals properly", () => {
    expect(autoSyncLine({ ...ran, interval_hours: 1 }, now)).toMatch(
      /^Syncs on its own every hour ·/,
    );
    expect(autoSyncLine({ ...ran, interval_hours: 0.5 }, now)).toMatch(/every 30 minutes ·/);
    expect(autoSyncLine({ ...ran, interval_hours: 1.5 }, now)).toMatch(/every 1.5 hours ·/);
  });
});

describe("autoSyncProblems", () => {
  it("lists only the sources that failed, by the name the owner knows them by", () => {
    const failed: AutoSyncStatus = {
      ...ran,
      state: "error",
      sources: {
        garmin: { state: "error", message: "The saved Garmin session is no longer good." },
        fitbit: { state: "skipped", message: "Google Health is not connected." },
      },
    };
    expect(autoSyncProblems(failed)).toEqual([
      { source: "Garmin", message: "The saved Garmin session is no longer good." },
    ]);
    expect(autoSyncProblems(ran)).toEqual([]);
    expect(autoSyncProblems({ ...failed, enabled: false, interval_hours: 0 })).toEqual([]);
  });
});
