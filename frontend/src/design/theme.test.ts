import { describe, expect, it } from "vitest";
import { isThemePreference, resolveTheme } from "@/design/theme";

describe("resolveTheme", () => {
  it("takes an explicit choice over the OS", () => {
    expect(resolveTheme("light", "dark")).toBe("light");
    expect(resolveTheme("dark", "light")).toBe("dark");
  });

  it("follows the OS when the choice is system", () => {
    expect(resolveTheme("system", "dark")).toBe("dark");
    expect(resolveTheme("system", "light")).toBe("light");
  });
});

describe("isThemePreference", () => {
  it("accepts the three the toggle offers", () => {
    expect(["light", "dark", "system"].every(isThemePreference)).toBe(true);
  });

  it("rejects anything else, including what localStorage might hold", () => {
    // Radix sends "" when the active toggle item is pressed again.
    expect(isThemePreference("")).toBe(false);
    expect(isThemePreference(null)).toBe(false);
    expect(isThemePreference("Dark")).toBe(false);
  });
});
