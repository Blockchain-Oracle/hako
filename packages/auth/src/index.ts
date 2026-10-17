// @hako/auth (server-only, plan §5b): Better Auth — Hako sessions, `jwt()` and, in Phase 2 (L5), the MCP login
// plugins. Mounted by the web at `app/api/auth/[...all]/route.ts` through `authRouteHandlers`.
import "server-only";

import { webPool } from "@hako/db";
import { loadWebEnv } from "@hako/env";

import { createAuth, type HakoAuth } from "./node.ts";

export * from "./node.ts";

let auth: HakoAuth | undefined;

/**
 * The web server's Better Auth instance, built on first use (so `next build` needs no secrets) from the web env:
 * BETTER_AUTH_SECRET, BETTER_AUTH_URL (default `https://usehako.xyz`) and DATABASE_URL. A missing secret stops it
 * with the variable's name: Hako never falls back to Better Auth's development secret.
 */
export function getAuth(): HakoAuth {
  if (auth) return auth;
  const env = loadWebEnv();
  if (!env.BETTER_AUTH_SECRET) throw new Error("BETTER_AUTH_SECRET is not set: Better Auth can't sign Hako sessions.");
  auth = createAuth({ pool: webPool(), secret: env.BETTER_AUTH_SECRET, baseURL: env.BETTER_AUTH_URL });
  return auth;
}

const handle = (request: Request): Promise<Response> => getAuth().handler(request);

/** The route handlers `app/api/auth/[...all]/route.ts` exports (Better Auth's `toNextJsHandler`, built lazily). */
export const authRouteHandlers = { GET: handle, POST: handle } as const;
