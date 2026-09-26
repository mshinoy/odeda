import { describe, expect, it } from "vitest";
import { ApiError } from "@/api/client";
import {
  initialSignInState,
  signInReducer,
  type SignInState,
} from "@/features/settings/garminSignIn";

const mfaState: SignInState = {
  stage: { kind: "mfa", challengeId: "c1", expiresInS: 300 },
  notice: null,
  fallbackOpen: false,
};

describe("signInReducer", () => {
  it("moves to the code step when Garmin asks for one", () => {
    const next = signInReducer(initialSignInState, {
      type: "login_answered",
      result: { status: "mfa_required", challenge_id: "abc", expires_in_s: 300 },
    });

    expect(next.stage).toEqual({ kind: "mfa", challengeId: "abc", expiresInS: 300 });
    expect(next.notice?.tone).toBe("info");
  });

  it("names the account when a login connects outright", () => {
    const next = signInReducer(initialSignInState, {
      type: "login_answered",
      result: {
        status: "ok",
        display_name: "runner",
        connected: true,
        token_dir: "/tokens",
        tokens_updated_at: "2026-09-26T06:00:00Z",
      },
    });

    expect(next.stage.kind).toBe("password");
    expect(next.notice).toEqual({ tone: "info", message: "Connected as runner." });
  });

  it("still says something when Garmin returns no display name", () => {
    const next = signInReducer(initialSignInState, { type: "connected", displayName: "" });

    expect(next.notice?.message).toBe("Connected as your Garmin account.");
  });

  it("opens the browser fallback on a 503, which a password cannot fix", () => {
    const next = signInReducer(initialSignInState, {
      type: "failed",
      error: new ApiError(503, { detail: "Garmin refused the login" }),
    });

    expect(next.fallbackOpen).toBe(true);
    expect(next.notice).toEqual({ tone: "error", message: "Garmin refused the login" });
  });

  it("leaves the fallback closed on a rejected password", () => {
    const next = signInReducer(initialSignInState, {
      type: "failed",
      error: new ApiError(401, { detail: "Garmin rejected that email and password." }),
    });

    expect(next.fallbackOpen).toBe(false);
    expect(next.stage.kind).toBe("password");
  });

  it("does not close a fallback the user opened, on a later failure", () => {
    const opened = signInReducer(initialSignInState, { type: "toggle_fallback", open: true });
    const next = signInReducer(opened, { type: "failed", error: new ApiError(502, null) });

    expect(next.fallbackOpen).toBe(true);
  });

  it("returns to the password step when the challenge has expired (410)", () => {
    const next = signInReducer(mfaState, {
      type: "failed",
      error: new ApiError(410, { detail: "that login attempt has expired" }),
    });

    // The challenge is gone from the server's memory: the code field has nothing
    // left to post into, so the only way on is a fresh login.
    expect(next.stage.kind).toBe("password");
  });

  it("stays on the code step when the code was merely wrong", () => {
    const next = signInReducer(mfaState, {
      type: "failed",
      error: new ApiError(502, { detail: "MFA verification failed" }),
    });

    expect(next.stage).toEqual(mfaState.stage);
  });

  it("falls back to a readable message for an error with none", () => {
    const next = signInReducer(initialSignInState, { type: "failed", error: {} });

    expect(next.notice?.message).toBe("That did not work. Try again.");
  });

  it("restart clears everything, including a connected notice", () => {
    const connected = signInReducer(initialSignInState, {
      type: "connected",
      displayName: "runner",
    });

    expect(signInReducer(connected, { type: "restart" })).toEqual(initialSignInState);
  });
});
