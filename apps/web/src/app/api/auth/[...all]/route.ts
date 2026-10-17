/**
 * Better Auth (plan E33, @hako/auth): Hako sessions, `/api/auth/jwks` for the gateway's JWT check, and `/api/auth/ok`.
 * The instance is built on the first request from the web env, so `next build` needs no secrets.
 */
import { authRouteHandlers } from "@hako/auth";

export const dynamic = "force-dynamic";

export const { GET, POST } = authRouteHandlers;
