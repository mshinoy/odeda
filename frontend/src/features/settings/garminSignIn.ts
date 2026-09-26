import { ApiError } from "@/api/client";
import type { GarminLoginResult } from "@/api/queries/useGarmin";

/**
 * The sign-in flow as a value, so the panel that draws it holds no branching logic.
 *
 * Three routes end in the same place: a password, a password plus a code, and the
 * browser ticket of D44. Which one is on screen is `stage`; `notice` is the last
 * thing the server said about it.
 */
export type Stage = { kind: "password" } | { kind: "mfa"; challengeId: string; expiresInS: number };

export type NoticeTone = "info" | "error";

export interface Notice {
  tone: NoticeTone;
  message: string;
}

export interface SignInState {
  stage: Stage;
  notice: Notice | null;
  /** Whether the browser-ticket fallback is expanded. A 503 opens it. */
  fallbackOpen: boolean;
}

export const initialSignInState: SignInState = {
  stage: { kind: "password" },
  notice: null,
  fallbackOpen: false,
};

export type SignInEvent =
  | { type: "login_answered"; result: GarminLoginResult }
  | { type: "connected"; displayName: string }
  | { type: "failed"; error: unknown }
  | { type: "toggle_fallback"; open: boolean }
  | { type: "restart" };

/**
 * Garmin refused the host rather than the credentials: every sign-in route it
 * offers answered with a rate limit. Retyping a password cannot fix that, so the
 * fallback opens itself instead of leaving the user to find it.
 */
const HOST_REFUSED = 503;

export function signInReducer(state: SignInState, event: SignInEvent): SignInState {
  switch (event.type) {
    case "login_answered":
      if (event.result.status === "mfa_required") {
        return {
          ...state,
          stage: {
            kind: "mfa",
            challengeId: event.result.challenge_id,
            expiresInS: event.result.expires_in_s,
          },
          notice: { tone: "info", message: "Garmin wants a code. Enter it below." },
        };
      }
      return connected(state, event.result.display_name);

    case "connected":
      return connected(state, event.displayName);

    case "failed":
      return {
        ...state,
        // An expired MFA challenge is gone from the server's memory, so the code
        // field would post into nothing; the password step is the only way back.
        stage: isChallengeGone(event.error) ? { kind: "password" } : state.stage,
        notice: { tone: "error", message: errorMessage(event.error) },
        fallbackOpen: state.fallbackOpen || statusOf(event.error) === HOST_REFUSED,
      };

    case "toggle_fallback":
      return { ...state, fallbackOpen: event.open };

    case "restart":
      return initialSignInState;
  }
}

function connected(state: SignInState, displayName: string): SignInState {
  const who = displayName === "" ? "your Garmin account" : displayName;
  return {
    ...state,
    stage: { kind: "password" },
    notice: { tone: "info", message: `Connected as ${who}.` },
    fallbackOpen: false,
  };
}

/** 410: the challenge expired or was already spent. */
function isChallengeGone(error: unknown): boolean {
  return statusOf(error) === 410;
}

function statusOf(error: unknown): number | null {
  return error instanceof ApiError ? error.status : null;
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message !== "") return error.message;
  return "That did not work. Try again.";
}
