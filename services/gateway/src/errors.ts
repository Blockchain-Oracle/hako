/** The gateway's one error envelope: `{error: {code, message, retryable, details}}`. */

import type { Context } from "hono";

import { HTTP_BAD_GATEWAY, HTTP_UNAVAILABLE } from "./constants.js";

export type ErrorStatus = 400 | 404 | 413 | 502 | 503;

export function jsonError(c: Context, status: ErrorStatus, code: string, message: string, details: string[] = []) {
  const retryable = status === HTTP_BAD_GATEWAY || status === HTTP_UNAVAILABLE;
  return c.json({ error: { code, message, retryable, details } }, status);
}
