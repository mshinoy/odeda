// The palette validator. Every categorical set in `tokens.ts` has to stay readable for
// someone who cannot see one of the cone types, in both themes; this is what "checked
// with the palette validator" in the token comments means.
import { describe, expect, it } from "vitest";
import { closestPair, difference, VISIONS, type Vision } from "@/design/cvd";
import { colorTokens, type Theme } from "@/design/tokens";

/**
 * CIE76 colour difference thresholds. A just-noticeable difference is about 2.3, so
 * these are far above "tell apart with effort": they are "obviously different colours".
 *
 * The three activity kinds clear 25 under every vision type. Five series colours
 * cannot — colour-blind vision collapses the hue circle towards one axis, and five
 * points on a shorter line sit closer together — so they clear 18 and carry a legend.
 */
const KIND_MIN = 25;
const SERIES_MIN = 18;
/** A series colour must also stand off the surface it is drawn on. */
const SURFACE_MIN = 30;

const THEMES: Theme[] = ["light", "dark"];

function report(colors: readonly string[], vision: Vision): string {
  const worst = closestPair(colors, vision);
  return `${vision}: ${worst.a} and ${worst.b} differ by ${worst.difference.toFixed(1)}`;
}

describe.each(THEMES)("%s palette", (theme) => {
  const tokens = colorTokens[theme];

  it.each(VISIONS)("keeps the activity kinds apart under %s", (vision) => {
    // Walk, strength and other share one neutral on purpose; the three sports do not.
    const kinds = [tokens.kind.run, tokens.kind.ride, tokens.kind.swim];
    expect(closestPair(kinds, vision).difference, report(kinds, vision)).toBeGreaterThan(KIND_MIN);
  });

  it.each(VISIONS)("keeps the five series apart under %s", (vision) => {
    expect(
      closestPair(tokens.series, vision).difference,
      report(tokens.series, vision),
    ).toBeGreaterThan(SERIES_MIN);
  });

  it("keeps every series colour off the surface it is drawn on", () => {
    for (const color of tokens.series) {
      expect(difference(color, tokens.surface), `${color} on ${tokens.surface}`).toBeGreaterThan(
        SURFACE_MIN,
      );
    }
  });

  it("gives the magnitude ramp a visible step from end to end", () => {
    const ramp = tokens.metricRamp;
    const low = ramp[0];
    const high = ramp[ramp.length - 1];
    if (low === undefined || high === undefined) throw new Error("the ramp is empty");
    // The ramp is read as an ordered scale, not as categories, so only its span matters.
    expect(difference(low, high)).toBeGreaterThan(40);
  });
});
