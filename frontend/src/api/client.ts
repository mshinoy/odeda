import createClient, { type Middleware } from "openapi-fetch";
import type { paths } from "@/api/schema";

/** A non-2xx API response, with FastAPI's `detail` flattened into a readable message. */
export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, body: unknown) {
    super(detailMessage(body) ?? `Request failed with status ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

/** FastAPI sends `{detail: string}` for HTTPException and `{detail: [{loc, msg}]}` for 422s. */
export function detailMessage(body: unknown): string | null {
  if (!isRecord(body)) return typeof body === "string" && body !== "" ? body : null;
  const detail = body.detail;
  if (typeof detail === "string") return detail;
  if (!Array.isArray(detail)) return null;

  const messages = detail.filter(isRecord).map(validationMessage);
  return messages.length > 0 ? messages.join("; ") : null;
}

function validationMessage(item: Record<string, unknown>): string {
  const msg = typeof item.msg === "string" ? item.msg : "Invalid value";
  // loc is e.g. ["query", "limit"]; the leading location adds nothing for a reader.
  const loc = Array.isArray(item.loc) ? item.loc.slice(1).map(String).join(".") : "";
  return loc === "" ? msg : `${loc}: ${msg}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The shape every openapi-fetch call resolves to, success or not. */
interface ApiResult {
  data?: unknown;
  error?: unknown;
  response: Response;
}

/** Returns the response data, or throws ApiError for any non-2xx response. */
export function unwrap<R extends ApiResult>(result: R): Exclude<R["data"], undefined> {
  if (!result.response.ok) throw new ApiError(result.response.status, result.error);
  // openapi-fetch fills `data` whenever the response is ok (undefined only for empty
  // bodies, which none of our JSON endpoints return); TypeScript can't narrow on `ok`.
  return result.data as Exclude<R["data"], undefined>;
}

/**
 * Whether a 401 from this path means *this app's* session expired.
 *
 * Two families are exempt. `/api/auth/*` is the session itself. `/api/garmin/*`
 * answers 401 when **Garmin** rejects an email and password — a different account
 * entirely, and bouncing the user out of Settings for it would lose what they typed.
 */
export function isSessionPath(pathname: string): boolean {
  if (!pathname.startsWith("/api/")) return false;
  return !pathname.startsWith("/api/auth/") && !pathname.startsWith("/api/garmin/");
}

/** A 401 on a session path means the session expired: send the user to log in again. */
const redirectOnUnauthorized: Middleware = {
  onResponse({ request, response }) {
    if (response.status !== 401) return;
    if (!isSessionPath(new URL(request.url).pathname)) return;
    if (window.location.pathname === "/login") return;

    const next = window.location.pathname + window.location.search;
    window.location.assign(`/login?next=${encodeURIComponent(next)}`);
  },
};

// Same-origin: Vite proxies /api in dev, FastAPI serves the SPA in prod.
export const api = createClient<paths>({ baseUrl: "", credentials: "same-origin" });
api.use(redirectOnUnauthorized);
