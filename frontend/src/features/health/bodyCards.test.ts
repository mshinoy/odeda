import { describe, expect, it } from "vitest";
import type { BodyConsistency, BodyLatest, RaceWeightProjection } from "@/api/queries/useBody";
import {
  bodyCards,
  changeCard,
  consistencyCard,
  fatCard,
  leanCard,
  projectionCard,
  STALE_AFTER_DAYS,
  weightCard,
} from "@/features/health/bodyCards";
import { projectionSentences } from "@/features/health/projectionNote";

const latest: BodyLatest = {
  day: "2026-09-21",
  trend_kg: 74.44,
  reading_kg: 74.12,
  fat_kg: 11.16,
  lean_kg: 63.28,
  change_kg: -3.89,
  fat_change_kg: -4.66,
  lean_change_kg: 0.77,
};

const consistency: BodyConsistency = {
  readings: 401,
  span_days: 539,
  coverage_pct: 74.4,
  per_week: 5.21,
  longest_gap_days: 13,
  days_since_last: 1,
};

const projection: RaceWeightProjection = {
  race_name: "Doha Marathon by Ooredoo — Half Marathon",
  race_day: "2027-01-15",
  days_out: 115,
  current_trend_kg: 74.44,
  projected_kg: 72.9,
  change_kg: -1.54,
  slope_kg_per_week: -0.09,
  window_days: 56,
  readings_used: 38,
  rule_of_thumb_s_per_km: -4.2,
  rule_of_thumb_race_s: -88,
};

describe("body cards", () => {
  it("leads with the trend and keeps the reading as the lesser fact", () => {
    // The point of the whole section: the big number is never one morning.
    const card = weightCard(latest);
    expect(card.value).toBe("74.4 kg");
    expect(card.delta).toBe("last reading 74.1");
    expect(card.tone).toBe("neutral");
  });

  it("reads fat down as good news and lean down as bad news", () => {
    // The same kilogram on a scale; opposite verdicts here, which is why the split
    // chart exists at all.
    expect(fatCard(latest)?.tone).toBe("good");
    expect(leanCard(latest)?.tone).toBe("good");
    expect(leanCard({ ...latest, lean_change_kg: -1.2 })?.tone).toBe("bad");
    expect(fatCard({ ...latest, fat_change_kg: 1.2 })?.tone).toBe("bad");
  });

  it("does not colour a change too small to mean anything", () => {
    expect(changeCard({ ...latest, change_kg: -0.02 }).tone).toBe("neutral");
  });

  it("hides the split cards rather than showing a dash", () => {
    // A manual weight entry has no body fat, and "– kg" teaches nothing.
    const noSplit = { ...latest, fat_kg: null, lean_kg: null };
    expect(fatCard(noSplit)).toBeNull();
    expect(leanCard(noSplit)).toBeNull();
    expect(bodyCards(noSplit, consistency, projection).map((c) => c.label)).toEqual([
      "Weight trend",
      "Over this window",
      "Weigh-ins",
      "Race day",
    ]);
  });

  it("flags a scale that has gone quiet", () => {
    // Every trend on the page degrades with gaps, so the card says so rather than the
    // charts quietly getting thinner.
    const quiet = { ...consistency, days_since_last: STALE_AFTER_DAYS + 5 };
    const card = consistencyCard(quiet);
    expect(card.tone).toBe("bad");
    expect(card.delta).toBe("none for 12 days");
  });

  it("flags weighing in less than twice a week", () => {
    expect(consistencyCard({ ...consistency, per_week: 1.2 }).tone).toBe("bad");
    expect(consistencyCard(consistency).tone).toBe("neutral");
  });

  it("puts the fitting window on the race card, never a time", () => {
    // A card is one number and a label. A time estimate on a card is the fastest way
    // for a rule of thumb to be read as a forecast.
    const card = projectionCard(projection);
    expect(card.value).toBe("72.9 kg");
    expect(card.delta).toBe("−1.5 kg in 115 days");
    expect(card.delta).not.toMatch(/faster|second/);
  });

  it("shows no race card when there was not enough to fit a line", () => {
    expect(bodyCards(latest, consistency, null).some((c) => c.label === "Race day")).toBe(false);
  });

  it("shows nothing at all when nothing has been weighed", () => {
    expect(bodyCards(null, consistency, null)).toEqual([]);
  });
});

describe("the projection note", () => {
  it("says what the projection was fitted on", () => {
    const [basis] = projectionSentences(projection);
    expect(basis).toContain("115 days");
    expect(basis).toContain("56 days");
    expect(basis).toContain("38 weigh-ins");
    expect(basis).toContain("2027-01-15");
  });

  it("calls the pace figure a rule of thumb and not a prediction", () => {
    // This is the sentence that keeps a heuristic from being read as physiology, so
    // it is asserted rather than left to a reviewer to notice if it disappears.
    const [, ruleOfThumb] = projectionSentences(projection);
    expect(ruleOfThumb).toContain("rule of thumb only");
    expect(ruleOfThumb).toContain("not a prediction");
    expect(ruleOfThumb).toContain("average across runners");
    expect(ruleOfThumb).toContain("fat rather than muscle");
  });

  it("reads losing weight as faster and gaining it as slower", () => {
    expect(projectionSentences(projection)[1]).toContain("1:28 faster");
    const gaining = { ...projection, change_kg: 1.54, rule_of_thumb_race_s: 88 };
    expect(projectionSentences(gaining)[1]).toContain("1:28 slower");
  });

  it("has no pace claim to qualify when the weight is not moving", () => {
    const flat = { ...projection, change_kg: 0, rule_of_thumb_race_s: 0 };
    expect(projectionSentences(flat)[1]).toBe(
      "No weight change means no pace estimate to qualify.",
    );
  });
});
