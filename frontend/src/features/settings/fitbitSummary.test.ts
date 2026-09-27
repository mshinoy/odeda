import { describe, expect, it } from "vitest";
import type { FitbitImportResult, FitbitStatus, FitbitSyncResult } from "@/api/queries/useFitbit";
import {
  fitbitStage,
  importSummary,
  storedSummary,
  syncSummary,
} from "@/features/settings/fitbitSummary";

const status: FitbitStatus = {
  connected: true,
  credentials_configured: true,
  user_id: "ABC123",
  last_synced_day: "2026-09-25",
  weigh_ins: 401,
  first_day: "2025-03-25",
  last_day: "2026-09-21",
  redirect_uri: "http://localhost:8000/api/fitbit/callback",
};

const sync: FitbitSyncResult = {
  endpoint: "fitbit_body",
  start_day: "2023-09-26",
  end_day: "2026-09-26",
  days_written: 401,
  weight_points: 470,
  body_fat_points: 428,
  state: "done",
  retry_after_s: null,
  last_day: "2026-09-26",
};

const imported: FitbitImportResult = {
  zip: "takeout.zip",
  members_scanned: 12,
  written: 401,
  units_found: ["kg"],
  unrecognised_count: 11,
  undecodable_count: 0,
};

describe("which state the panel is in", () => {
  it("tells apart the three problems, because they need three different things", () => {
    // No app registered, app registered but not authorised, and connected are not
    // degrees of the same state: a disabled button would leave the owner guessing
    // which of them they are in.
    expect(fitbitStage({ ...status, credentials_configured: false })).toBe("no_credentials");
    expect(fitbitStage({ ...status, connected: false })).toBe("not_connected");
    expect(fitbitStage(status)).toBe("connected");
  });

  it("reports no credentials even when a stale token cache is on disk", () => {
    // Without a client id nothing can refresh, so a cache is not a connection.
    expect(fitbitStage({ ...status, credentials_configured: false, connected: true })).toBe(
      "no_credentials",
    );
  });
});

describe("what is stored", () => {
  it("gives the count and the span", () => {
    expect(storedSummary(status)).toBe("401 weigh-ins (2025-03-25 → 2026-09-21)");
  });

  it("says nothing rather than zero before the first sync", () => {
    expect(storedSummary({ ...status, weigh_ins: 0, first_day: null, last_day: null })).toBe("–");
  });
});

describe("what a sync did", () => {
  it("reports what it fetched and the span", () => {
    expect(syncSummary(sync)).toBe(
      "401 weigh-ins from 470 weight and 428 body-fat readings, 2023-09-26 → 2026-09-26.",
    );
  });

  it("does not make a rate limit read as a failure", () => {
    // It kept everything it fetched and its watermark. "Sync failed" would send
    // the owner looking for a problem that is not there.
    const limited = { ...sync, state: "rate_limited", weight_points: 120, retry_after_s: 1830 };
    const text = syncSummary(limited);
    expect(text).toContain("120 weight and 428 body-fat readings");
    expect(text).toContain("31 minutes");
    expect(text).toContain("resumes where it stopped");
    expect(text).not.toMatch(/fail/i);
  });

  it("never says to come back in no time at all", () => {
    const limited = { ...sync, state: "rate_limited", retry_after_s: 20 };
    expect(syncSummary(limited)).toContain("1 minute");
  });

  it("falls back to a minute when Google did not say", () => {
    // Google's budget is 300 requests a minute, not Fitbit's 150 an hour. Telling
    // someone to wait an hour for a limit that clears in sixty seconds is its own bug.
    const limited = { ...sync, state: "rate_limited", retry_after_s: null };
    expect(syncSummary(limited)).toContain("1 minute");
  });
});

describe("what an import did", () => {
  it("says which unit the export turned out to be in", () => {
    // The file does not declare it; it is inferred from each record's own weight and
    // BMI, so the owner should be able to see that the inference agreed with reality.
    expect(importSummary(imported)).toBe("401 weigh-ins from 12 files (in kg).");
    expect(importSummary({ ...imported, units_found: ["kg", "lb"] })).toContain("in kg and lb");
  });

  it("leaves the unit out when nothing was recognised", () => {
    expect(importSummary({ ...imported, written: 0, units_found: [] })).toBe(
      "0 weigh-ins from 12 files.",
    );
  });
});
