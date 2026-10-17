/**
 * Small HTTP pieces these routes share: the gateway's error envelope for the statuses `jsonError` (src/errors.ts)
 * doesn't type, the caller's IP behind the proxy, and reading a route's params back from a path (settle hooks see a
 * path, not Hono's params).
 */

import type { Context } from "hono";

import { HTTP_UNAUTHORIZED } from "@hako/cards/contract";

import { HTTP_UNAVAILABLE, HTTP_UNPROCESSABLE } from "../../constants.js";
import { jsonError } from "../../errors.js";
import { HTTP_CONFLICT, HTTP_TOO_MANY_REQUESTS } from "./x402.config.js";

type RefusalStatus = typeof HTTP_UNAUTHORIZED | typeof HTTP_CONFLICT | typeof HTTP_TOO_MANY_REQUESTS | typeof HTTP_UNPROCESSABLE;

/** The same `{error: {code, message, retryable, details}}` envelope as `jsonError`. */
export function refuse(c: Context, status: RefusalStatus, code: string, message: string, details: string[] = []) {
  const retryable = status === HTTP_CONFLICT || status === HTTP_TOO_MANY_REQUESTS;
  return c.json({ error: { code, message, retryable, details } }, status);
}

/** A bearer that could not be checked (the issuer's key set timed out or is unreachable): 503, retryable, not "sign in again". */
export function sessionUnavailable(c: Context) {
  return jsonError(c, HTTP_UNAVAILABLE, "session_unavailable", "Your Hako session could not be checked right now; nothing was changed. Try again shortly.");
}

/**
 * The client's address as the edge proxy saw it: Traefik sets `X-Real-Ip` and appends to `X-Forwarded-For`, so only
 * those values are the proxy's own (the first `X-Forwarded-For` entry is whatever the client sent).
 */
export function clientIp(c: Context): string {
  const real = c.req.header("x-real-ip")?.trim();
  if (real) return real;
  const forwarded = c.req.header("x-forwarded-for")?.split(",").map((hop) => hop.trim()).filter(Boolean);
  return forwarded?.at(-1) ?? "unknown";
}

/** `/v2/batch/:batchId` against `/v2/batch/abc` → `{batchId: "abc"}`; null when the path is another route. */
export function matchPath(pattern: string, path: string): Record<string, string> | null {
  const want = pattern.split("/");
  const got = path.split(/[?#]/)[0]!.split("/");
  if (want.length !== got.length) return null;
  const params: Record<string, string> = {};
  for (const [index, segment] of want.entries()) {
    const value = got[index]!;
    if (segment.startsWith(":")) {
      if (!value) return null;
      try {
        params[segment.slice(1)] = decodeURIComponent(value);
      } catch {
        return null;
      }
    } else if (segment !== value) return null;
  }
  return params;
}
