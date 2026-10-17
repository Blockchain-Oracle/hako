/**
 * `GET /v1/files/<id>` (plan B12): bytes hako-api stored for FILE_TTL_S (generated audio from the ElevenLabs tiers),
 * forwarded as they come. The id is an opaque token: anything else is refused before it reaches the api.
 */

import type { Hono } from "hono";

import { GATEWAY_ENDPOINTS } from "@hako/cards/contract";
import { FILE_TTL_S } from "@hako/config";

import { HTTP_BAD_GATEWAY, HTTP_NOT_FOUND, HTTP_OK } from "../constants.js";
import { jsonError } from "../errors.js";
import type { X402Context } from "./x402/context.js";
import { FILE_ID_PATTERN } from "./x402/x402.config.js";

const PASSED_HEADERS = ["content-type", "content-length", "content-disposition", "etag", "last-modified"];

export function registerFiles(app: Hono, ctx: X402Context): void {
  app.get(GATEWAY_ENDPOINTS.file.path, async (c) => {
    const id = c.req.param("id");
    const missing = () => jsonError(c, HTTP_NOT_FOUND, "unknown_file", `no file ${id}: unknown, or older than a day`);
    if (!FILE_ID_PATTERN.test(id)) return missing();
    let upstream: Response;
    try {
      upstream = await ctx.api.file(id);
    } catch (error) {
      console.warn(JSON.stringify({ event: "file_forward_failed", id, error: String(error) }));
      return jsonError(c, HTTP_BAD_GATEWAY, "api_unreachable", "The tool router could not be reached.");
    }
    if (upstream.status === HTTP_NOT_FOUND) return missing();
    if (upstream.status !== HTTP_OK) return jsonError(c, HTTP_BAD_GATEWAY, "file_unavailable", `The tool router answered HTTP ${upstream.status}.`);
    // Bytes from a tool: never rendered as an active document on the gateway's origin.
    const headers = new Headers({
      "cache-control": `public, max-age=${FILE_TTL_S}, immutable`,
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; media-src 'self'; sandbox",
    });
    for (const name of PASSED_HEADERS) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    return new Response(upstream.body, { status: HTTP_OK, headers });
  });
}
