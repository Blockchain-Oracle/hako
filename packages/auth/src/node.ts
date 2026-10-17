// @hako/auth/node: Better Auth for Hako (Phase 1, plan §3 Auth row and E33) without the `server-only` guard, for plain
// Node processes (scripts, the migration generator). Next code imports the package root, which also reads the web env.
import { HAKO_APP_URL, HAKO_NAME } from "@hako/config";
import type { Pool } from "@hako/db/node";
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { jwt } from "better-auth/plugins/jwt";

import { AUTH_BASE_PATH, AUTH_COOKIE_PREFIX } from "./auth.config.ts";

export * from "./auth.config.ts";

export interface HakoAuthSettings {
  /** The @hako/db pool: Better Auth's tables live in the same Postgres schema (0001_better_auth.sql). */
  pool: Pool;
  /** BETTER_AUTH_SECRET (≥ 32 characters): signs sessions and encrypts the JWKS private keys at rest. */
  secret: string;
  /** The web app's origin (BETTER_AUTH_URL), `https://usehako.site` in production. */
  baseURL?: string;
}

/** The issuer Hako JWTs carry and the gateway verifies: `<baseURL>/api/auth` (`https://usehako.site/api/auth`). */
export function authIssuer(baseURL: string = HAKO_APP_URL): string {
  return new URL(AUTH_BASE_PATH, baseURL).toString();
}

/**
 * The one Better Auth configuration (sessions on Postgres, `jwt()` with its JWKS at `/api/auth/jwks`, and
 * `nextCookies()` last so server actions set cookies). Phase 2 (L5) adds the MCP login plugins in `src/mcp.ts`;
 * any plugin that adds tables needs a new migration from `pnpm --filter @hako/auth migration:generate`.
 */
export function hakoAuthOptions(settings: HakoAuthSettings) {
  const baseURL = settings.baseURL ?? HAKO_APP_URL;
  return {
    appName: HAKO_NAME,
    baseURL,
    basePath: AUTH_BASE_PATH,
    secret: settings.secret,
    database: settings.pool,
    advanced: { cookiePrefix: AUTH_COOKIE_PREFIX },
    telemetry: { enabled: false },
    plugins: [jwt({ jwt: { issuer: authIssuer(baseURL) } }), nextCookies()],
  } satisfies BetterAuthOptions;
}

export function createAuth(settings: HakoAuthSettings) {
  return betterAuth(hakoAuthOptions(settings));
}

export type HakoAuth = ReturnType<typeof createAuth>;
