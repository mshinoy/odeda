import { describe, expect, it } from "vitest";
import { ApiError, detailMessage, isSessionPath, unwrap } from "@/api/client";

describe("detailMessage", () => {
  it("reads a string detail", () => {
    expect(detailMessage({ detail: "Activity not found" })).toBe("Activity not found");
  });

  it("joins a 422 validation array, dropping the location prefix", () => {
    const body = {
      detail: [
        { loc: ["query", "limit"], msg: "Input should be a valid integer", type: "int_parsing" },
        { loc: ["body"], msg: "Field required", type: "missing" },
      ],
    };
    expect(detailMessage(body)).toBe("limit: Input should be a valid integer; Field required");
  });

  it("returns null when there is nothing readable", () => {
    expect(detailMessage(undefined)).toBeNull();
    expect(detailMessage({})).toBeNull();
    expect(detailMessage({ detail: [] })).toBeNull();
    expect(detailMessage("")).toBeNull();
  });

  it("passes through a plain-text body", () => {
    expect(detailMessage("Bad gateway")).toBe("Bad gateway");
  });
});

describe("unwrap", () => {
  it("returns data from an ok response", () => {
    const result = { data: { id: 1 }, response: new Response(null, { status: 200 }) };
    expect(unwrap(result)).toEqual({ id: 1 });
  });

  it("throws ApiError with status and message otherwise", () => {
    const result = {
      error: { detail: "Activity not found" },
      response: new Response(null, { status: 404 }),
    };
    expect(() => unwrap(result)).toThrow(ApiError);
    try {
      unwrap(result);
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(404);
      expect((error as ApiError).message).toBe("Activity not found");
    }
  });

  it("falls back to the status when the body has no detail", () => {
    const error = new ApiError(500, undefined);
    expect(error.message).toBe("Request failed with status 500");
  });
});

describe("isSessionPath", () => {
  it("claims an ordinary API path", () => {
    expect(isSessionPath("/api/activities")).toBe(true);
  });

  it("leaves the app's own login endpoints alone", () => {
    expect(isSessionPath("/api/auth/login")).toBe(false);
  });

  it("leaves the Garmin endpoints alone", () => {
    // Garmin answers 401 for a wrong Garmin password. That is not this app's
    // session, and redirecting would throw away the form the user is filling in.
    expect(isSessionPath("/api/garmin/login")).toBe(false);
  });

  it("ignores anything outside /api", () => {
    expect(isSessionPath("/activities/123")).toBe(false);
  });
});
