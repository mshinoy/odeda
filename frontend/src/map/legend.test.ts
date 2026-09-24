import { describe, expect, it } from "vitest";
import { colorTokens } from "@/design/tokens";
import { steppedGradient } from "@/map/legend";

describe("steppedGradient", () => {
  it("gives each ramp step an equal hard-edged band", () => {
    expect(steppedGradient(["red", "green", "blue", "white"])).toBe(
      "linear-gradient(to right, red 0% 25%, green 25% 50%, blue 50% 75%, white 75% 100%)",
    );
  });

  it("uses every step of the theme's ramp, low on the left", () => {
    const ramp = colorTokens.light.metricRamp;
    const gradient = steppedGradient(ramp);
    expect(gradient.startsWith(`linear-gradient(to right, ${ramp[0]} 0% `)).toBe(true);
    expect(gradient.endsWith(`${ramp.at(-1)} 85.714% 100%)`)).toBe(true);
  });
});
