import { describe, expect, it } from "vitest";
import { decodePolyline, decodePolylinePieces } from "@/lib/polyline";

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

describe("decodePolylinePieces", () => {
  it("decodes each piece on its own, so the gap between them is not a step", () => {
    const first = "_p~iF~ps|U_ulLnnqC";
    const second = "_p~iF~ps|U_ulLnnqC_mqNvxq`@";
    expect(decodePolylinePieces(`${first};${second}`)).toEqual([
      decodePolyline(first),
      decodePolyline(second),
    ]);
  });

  it("treats a route with no gap as one piece, and an empty string as none", () => {
    expect(decodePolylinePieces("_p~iF~ps|U_ulLnnqC")).toHaveLength(1);
    expect(decodePolylinePieces("")).toEqual([]);
  });
});
