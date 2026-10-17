import { HAKO_AUTH_ISSUER, HAKO_MCP_SERVER_NAME } from "@hako/config";

/**
 * Where Better Auth is mounted (`apps/web/src/app/api/auth/[...all]`), read from the issuer @hako/config names
 * (`https://usehako.xyz/api/auth`), so the path and the issuer can't drift apart.
 */
export const AUTH_BASE_PATH = new URL(HAKO_AUTH_ISSUER).pathname;

/** Hako's cookies read `hako.session_token`, `hako.session_data`… instead of Better Auth's default prefix. */
export const AUTH_COOKIE_PREFIX = HAKO_MCP_SERVER_NAME;
