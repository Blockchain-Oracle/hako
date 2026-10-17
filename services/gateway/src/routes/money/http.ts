/**
 * Request parsing and errors for the money routes: bodies and queries are checked against the endpoint table's zod
 * schemas (@hako/cards contract), and every failure answers with the gateway's one error envelope (errors.ts).
 */
import { LIFI_TIMEOUT_MS } from "@hako/config";
import { isTimeout, MAX_ERROR_CAUSE_DEPTH } from "@hako/defi/server";
import type { Context } from "hono";
import type { z } from "zod";

import { HTTP_BAD_GATEWAY, HTTP_BAD_REQUEST, HTTP_NOT_FOUND, HTTP_UNAVAILABLE } from "../../constants.js";
import { type ErrorStatus, jsonError } from "../../errors.js";
import { HTTP_SERVER_ERROR, HTTP_TOO_MANY_REQUESTS } from "./money.config.js";

/** A failure a money route answers with (status, code, words), thrown anywhere below the handler. */
export class MoneyRouteError extends Error {
  readonly status: ErrorStatus;
  readonly code: string;
  readonly details: string[];

  constructor(status: ErrorStatus, code: string, message: string, details: string[] = []) {
    super(message);
    this.name = "MoneyRouteError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (code: string, message: string, details: string[] = []) =>
  new MoneyRouteError(HTTP_BAD_REQUEST, code, message, details);
export const unavailable = (code: string, message: string) => new MoneyRouteError(HTTP_UNAVAILABLE, code, message);

const issuesOf = (error: z.ZodError) => error.issues.map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`);

function checked<S extends z.ZodType>(schema: S, raw: unknown, where: string): z.output<S> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw badRequest("invalid_request", `The ${where} does not fit this route's schema.`, issuesOf(parsed.error));
  return parsed.data;
}

/** The JSON body, checked against the route's schema (400 `invalid_json` / `invalid_request` otherwise). */
export async function readBody<S extends z.ZodType>(c: Context, schema: S): Promise<z.output<S>> {
  const text = await c.req.text();
  let raw: unknown;
  try {
    raw = text.trim() ? JSON.parse(text) : undefined;
  } catch {
    throw badRequest("invalid_json", "Request body is not valid JSON.");
  }
  return checked(schema, raw, "body");
}

export const readQuery = <S extends z.ZodType>(c: Context, schema: S): z.output<S> => checked(schema, c.req.query(), "query");

interface HttpCause {
  status: number;
  responseBody?: { message?: unknown };
}

/** LI.FI's HTTP answer inside the SDK's error (`SDKError.cause` → `HTTPError` with `status` and `responseBody`). */
function httpCause(error: unknown): HttpCause | undefined {
  let current: unknown = error;
  for (let depth = 0; current instanceof Error && depth < MAX_ERROR_CAUSE_DEPTH; depth += 1) {
    const { status, responseBody } = current as { status?: unknown; responseBody?: HttpCause["responseBody"] };
    if (typeof status === "number") return { status, responseBody };
    current = current.cause;
  }
  return undefined;
}

/** A LI.FI failure in words the card can show: no route, rate-limited, rejected input, timeout or unreachable. */
export function lifiFailure(error: unknown): MoneyRouteError {
  if (error instanceof MoneyRouteError) return error;
  if (isTimeout(error)) return unavailable("lifi_timeout", `LI.FI didn't answer within ${LIFI_TIMEOUT_MS} ms; try again.`);
  if (error instanceof RangeError) return badRequest("unsupported_chain", error.message);
  const http = httpCause(error);
  const said = typeof http?.responseBody?.message === "string" ? http.responseBody.message : null;
  if (http?.status === HTTP_NOT_FOUND) return new MoneyRouteError(HTTP_NOT_FOUND, "no_route", said ?? "LI.FI found no route for this move.");
  if (http?.status === HTTP_TOO_MANY_REQUESTS) return unavailable("lifi_rate_limited", "LI.FI is rate-limiting quotes right now; try again in a minute.");
  if (http && http.status >= HTTP_BAD_REQUEST && http.status < HTTP_SERVER_ERROR) {
    return badRequest("lifi_rejected", said ?? `LI.FI refused this request (HTTP ${http.status}).`);
  }
  console.error(JSON.stringify({ event: "lifi_failed", error: String(error) }));
  return new MoneyRouteError(HTTP_BAD_GATEWAY, "lifi_unreachable", "LI.FI could not be reached; nothing was sent.");
}

/** A LI.FI call whose failure becomes the route's answer (`lifiFailure`). */
export const viaLifi = <T>(call: Promise<T>): Promise<T> =>
  call.catch((error: unknown) => {
    throw lifiFailure(error);
  });

/** Runs a money route's work; a MoneyRouteError becomes the error envelope, anything else a logged 502. */
export async function answer(c: Context, work: () => Promise<Response>): Promise<Response> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof MoneyRouteError) return jsonError(c, error.status, error.code, error.message, error.details);
    console.error(JSON.stringify({ event: "money_route_failed", path: c.req.path, error: String(error) }));
    return jsonError(c, HTTP_BAD_GATEWAY, "upstream_failed", "A service this route depends on failed; nothing was sent.");
  }
}
