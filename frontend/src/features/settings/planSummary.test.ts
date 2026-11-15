import { describe, expect, it } from "vitest";
import type { Plan, PlanDecision } from "@/api/queries/usePlan";
import type { AutoSyncStatus } from "@/api/queries/useStatus";
import {
  decisionLine,
  feedStatus,
  planAutoSyncProblem,
  planSyncSummary,
  unreadableLine,
} from "@/features/settings/planSummary";

const NOW = new Date("2026-10-08T12:00:00Z");

function plan(over: Partial<Plan> = {}): Plan {
  return {
    subscribed: true,
    source: {
      label: "Training",
      kind: "ics",
      url_masked: "https://calendar.google.com/calendar/ical/…/basic.ics",
      last_fetch_at: "2026-10-08T11:00:00",
      last_error: null,
    },
    today: "2026-10-08",
    weeks: [],
    adherence_4wk: null,
    this_week: null,
    next_session: null,
    decisions: [],
    targets: {
      peak_weekly_km: null,
      mean_weekly_km: null,
      source: "none",
      ctl_target: null,
      load_per_km: null,
    },
    unreadable: [],
    unplanned: [],
    ...over,
  };
}

function autoSync(over: Partial<AutoSyncStatus> = {}): AutoSyncStatus {
  return {
    enabled: true,
    interval_hours: 6,
    running: false,
    state: "ok",
    message: null,
    started_at: null,
    finished_at: null,
    next_run_at: null,
    sources: {},
    ...over,
  } as AutoSyncStatus;
}

describe("feedStatus", () => {
  it("says there is nothing subscribed before anything else", () => {
    expect(feedStatus(plan({ subscribed: false, source: null }), NOW).tone).toBe("neutral");
  });

  it("shows the feed's own error loudly, because that one needs acting on", () => {
    const broken = plan({
      source: {
        label: null,
        kind: "ics",
        url_masked: "…/basic.ics",
        last_fetch_at: "2026-10-01T06:00:00",
        last_error: "the calendar's secret address was reset; copy the new one",
      },
    });
    const status = feedStatus(broken, NOW);
    expect(status.tone).toBe("critical");
    expect(status.text).toContain("reset");
  });

  it("distinguishes subscribed-but-never-read from working", () => {
    const fresh = plan({
      source: { label: null, kind: "ics", url_masked: "…", last_fetch_at: null, last_error: null },
    });
    expect(feedStatus(fresh, NOW).tone).toBe("warning");
    expect(feedStatus(plan(), NOW).tone).toBe("good");
  });
});

describe("planSyncSummary", () => {
  it("counts what came back in sessions, not in HTTP", () => {
    expect(planSyncSummary({ status: "ok", sessions: 59, parsed_ok: 59 })).toBe(
      "59 sessions read.",
    );
  });

  it("names everything that did not come through cleanly", () => {
    const summary = planSyncSummary({
      status: "ok",
      sessions: 40,
      withdrawn: 3,
      parsed_unparsed: 2,
      unsupported: 1,
    });
    expect(summary).toContain("3 withdrawn");
    expect(summary).toContain("2 not understood");
    expect(summary).toContain("repeat rule");
  });

  it("does not make an unchanged feed look like a failure (T39)", () => {
    expect(planSyncSummary({ status: "unchanged" })).toContain("not changed");
  });

  it("passes a skip's own reason through", () => {
    expect(planSyncSummary({ status: "skipped", reason: "no calendar subscribed" })).toBe(
      "no calendar subscribed",
    );
  });
});

describe("unreadableLine", () => {
  it("says nothing when the parser understood everything", () => {
    expect(unreadableLine(plan())).toBeNull();
  });

  it("says they are in no adherence figure, which is the point of the list", () => {
    const withMisses = plan({
      unreadable: [
        {
          id: 1,
          day: "2026-10-02",
          title: "Club run",
          description: null,
          parse_status: "unparsed",
        },
        {
          id: 2,
          day: "2026-10-09",
          title: "Something",
          description: null,
          parse_status: "unsupported_rrule",
        },
      ],
    });
    expect(unreadableLine(withMisses)).toContain("no adherence figure");
  });
});

describe("decisionLine", () => {
  const decision: PlanDecision = {
    plan_session_id: 7,
    day: "2026-10-02",
    title: "W7: LONG RUN 10.0 km",
    link_type: "ignored",
    activity_id: null,
    linked_at: "2026-10-08T09:00:00",
  };

  it("says which decision it was", () => {
    expect(decisionLine(decision, NOW)).toContain("ignored");
    expect(decisionLine({ ...decision, link_type: "manual", activity_id: "a" }, NOW)).toContain(
      "linked by hand",
    );
  });
});

describe("planAutoSyncProblem", () => {
  it("reports the plan source's own failure from the automatic run", () => {
    const status = autoSync({
      sources: { plan: { state: "error", message: "the secret address was reset" } },
    } as Partial<AutoSyncStatus>);
    expect(planAutoSyncProblem(status)).toContain("reset");
  });

  it("stays quiet when the automatic sync is off", () => {
    const status = autoSync({
      enabled: false,
      sources: { plan: { state: "error", message: "boom" } },
    } as Partial<AutoSyncStatus>);
    expect(planAutoSyncProblem(status)).toBeNull();
  });

  it("stays quiet on a run that worked", () => {
    expect(planAutoSyncProblem(autoSync())).toBeNull();
  });
});
