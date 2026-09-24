import { describe, expect, it } from "vitest";
import { safeNextPath } from "@/features/auth/safeNextPath";

describe("safeNextPath", () => {
  it("follows in-app paths", () => {
    expect(safeNextPath("/activities/123?x=1")).toBe("/activities/123?x=1");
  });

  it("falls back to / for anything else", () => {
    for (const next of [null, "", "https://evil.example", "//evil.example", "/\\evil", "/login"]) {
      expect(safeNextPath(next)).toBe("/");
    }
  });
});
