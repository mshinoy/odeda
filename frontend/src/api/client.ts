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

type ApiResult<T> =
  | { data: T; error?: never; response: Response }
  | { data?: never; error: unknown; response: Response };

/** Returns the response data, or throws ApiError for any non-2xx response. */
export function unwrap<T>(result: ApiResult<T>): T {
  if (!result.response.ok) throw new ApiError(result.response.status, result.error);
  // openapi-fetch fills `data` whenever the response is ok (undefined only for empty bodies).
  return result.data as T;
}

/** A 401 outside /api/auth/* means the session expired: send the user to log in again. */
const redirectOnUnauthorized: Middleware = {
  onResponse({ request, response }) {
    if (response.status !== 401) return;
    const { pathname } = new URL(request.url);
    if (!pathname.startsWith("/api/") || pathname.startsWith("/api/auth/")) return;
    if (window.location.pathname === "/login") return;

    const next = window.location.pathname + window.location.search;
    window.location.assign(`/login?next=${encodeURIComponent(next)}`);
  },
};

// Same-origin: Vite proxies /api in dev, FastAPI serves the SPA in prod.
export const api = createClient<paths>({ baseUrl: "", credentials: "same-origin" });
api.use(redirectOnUnauthorized);
