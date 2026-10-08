import { describe, expect, it } from "vitest";
import { decodePolyline } from "@/lib/polyline";

describe("decodePolyline", () => {
  it("reads Google's own example", () => {
    expect(decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@")).toEqual([
      [38.5, -120.2],
      [40.7, -120.95],
      [43.252, -126.453],
    ]);
  });

  it("is empty for an empty string, and stops at a truncated point", () => {
    expect(decodePolyline("")).toEqual([]);
    expect(decodePolyline("_p~iF~ps|U_ulL")).toEqual([[38.5, -120.2]]);
  });
});
