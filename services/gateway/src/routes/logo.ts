/**
 * `GET /v1/logo?src=<url>` (plan B12, §3 logos row): one cached host for the 10+ hosts LI.FI's `logoURI`s point at,
 * and the only image host the MCP view's CSP allows. https only, allowlisted hosts only (every redirect hop too), images
 * only, LOGO_MAX_BYTES at most; cached LOGO_CACHE_TTL_S in the gateway's store and by browsers.
 */

import { createHash } from "node:crypto";

import type { Context, Hono } from "hono";

import { logoQuerySchema } from "@hako/cards/contract";
import { HAKO_LOGO_PROXY_PATH, LOGO_CACHE_TTL_S } from "@hako/config";

import { HTTP_BAD_GATEWAY, HTTP_BAD_REQUEST, HTTP_NOT_FOUND, HTTP_OK } from "../constants.js";
import { jsonError } from "../errors.js";
import type { X402Context } from "./x402/context.js";
import { HTTP_FIRST_REDIRECT, KV_PREFIX, LOGO_CONTENT_TYPES, LOGO_FETCH_TIMEOUT_MS, LOGO_HOSTS, LOGO_MAX_BYTES, LOGO_MAX_REDIRECTS, LOGO_SVG_CSP } from "./x402/x402.config.js";

interface Logo {
  contentType: string;
  bytes: Buffer;
}

const HOSTS = new Set<string>(LOGO_HOSTS);
const TYPES = new Set<string>(LOGO_CONTENT_TYPES);

/** A URL the proxy may fetch: https on the default port, an allowlisted host, no credentials. */
function allowed(url: URL): boolean {
  return url.protocol === "https:" && HOSTS.has(url.hostname) && !url.port && !url.username && !url.password;
}

/** The body, or null once it passes `max` bytes (read as a stream, so a huge body is never buffered whole). */
async function readCapped(res: Response, max: number): Promise<Buffer | null> {
  if (!res.body) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    size += chunk.byteLength;
    if (size > max) return null;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

type Fetched = Logo | { refused: string };

async function fetchLogo(fetchImpl: typeof fetch, src: URL): Promise<Fetched> {
  let url = src;
  for (let hop = 0; hop <= LOGO_MAX_REDIRECTS; hop += 1) {
    const res = await fetchImpl(url, { redirect: "manual", headers: { accept: "image/*" }, signal: AbortSignal.timeout(LOGO_FETCH_TIMEOUT_MS) });
    const location = res.headers.get("location");
    if (location && res.status >= HTTP_FIRST_REDIRECT && res.status < HTTP_BAD_REQUEST) {
      url = new URL(location, url);
      if (!allowed(url)) return { refused: `redirects to ${url.hostname}, which is not an allowlisted logo host` };
      continue;
    }
    if (res.status !== HTTP_OK) return { refused: `the logo host answered HTTP ${res.status}` };
    const contentType = (res.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
    if (!TYPES.has(contentType)) return { refused: `not an image (${contentType || "no content type"})` };
    const bytes = await readCapped(res, LOGO_MAX_BYTES);
    return bytes ? { contentType, bytes } : { refused: `larger than ${LOGO_MAX_BYTES} bytes` };
  }
  return { refused: "too many redirects" };
}

function logoResponse(logo: Logo): Response {
  return new Response(new Uint8Array(logo.bytes), {
    status: HTTP_OK,
    headers: {
      "content-type": logo.contentType,
      "cache-control": `public, max-age=${LOGO_CACHE_TTL_S}, immutable`,
      "x-content-type-options": "nosniff",
      // An SVG opened on its own must never run script on the gateway's origin.
      "content-security-policy": LOGO_SVG_CSP,
      "cross-origin-resource-policy": "cross-origin",
    },
  });
}

export function registerLogo(app: Hono, ctx: X402Context): void {
  const cacheKey = (src: URL) => `${KV_PREFIX}:logo:${createHash("sha256").update(src.href).digest("hex")}`;

  app.get(HAKO_LOGO_PROXY_PATH, async (c: Context) => {
    const query = logoQuerySchema.safeParse(c.req.query());
    if (!query.success) return jsonError(c, HTTP_BAD_REQUEST, "invalid_src", "Pass the logo's https URL as ?src=.");
    const src = new URL(query.data.src);
    if (!allowed(src)) {
      return jsonError(c, HTTP_BAD_REQUEST, "logo_host_not_allowed", `${src.hostname} is not an allowlisted logo host (https only).`);
    }
    const cached = ctx.kv ? await ctx.kv.get(cacheKey(src)).catch(() => null) : null;
    if (cached) {
      const { contentType, base64 } = JSON.parse(cached) as { contentType: string; base64: string };
      return logoResponse({ contentType, bytes: Buffer.from(base64, "base64") });
    }
    let fetched: Fetched;
    try {
      fetched = await fetchLogo(ctx.fetch, src);
    } catch (error) {
      console.warn(JSON.stringify({ event: "logo_fetch_failed", host: src.hostname, error: String(error) }));
      return jsonError(c, HTTP_BAD_GATEWAY, "logo_unreachable", `${src.hostname} did not answer.`);
    }
    if ("refused" in fetched) return jsonError(c, HTTP_NOT_FOUND, "logo_unavailable", `No logo at that URL: ${fetched.refused}.`);
    if (ctx.kv) {
      const entry = JSON.stringify({ contentType: fetched.contentType, base64: fetched.bytes.toString("base64") });
      await ctx.kv.set(cacheKey(src), entry, LOGO_CACHE_TTL_S).catch(() => undefined);
    }
    return logoResponse(fetched);
  });
}
