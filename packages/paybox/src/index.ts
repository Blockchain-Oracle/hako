// @hako/paybox (server-only, plan §5b): per-user PayBox clients, PKCE, the one encrypted token store, refresh under a
// per-user Redis lock, PayBox core tools over MCP, request polling and status → card phase; the money intents' contract
// (src/intents/types.ts, implemented in W0.6). Next code imports this root; the gateway and the CLI import
// `@hako/paybox/node`.
import "server-only";

import { webPool } from "@hako/db";
import { loadWebEnv } from "@hako/env";
import { Redis } from "ioredis";

import { createPayboxServer, type PayboxServer } from "./server.ts";

export * from "./node.ts";

type Slot = { server?: PayboxServer; redis?: Redis };
const slot = globalThis as typeof globalThis & { __hakoPaybox?: Slot };

/**
 * The web server's PayBox wiring, built on first use from the web env (DATABASE_URL, REDIS_URL,
 * HAKO_TOKEN_ENCRYPTION_KEY, PAYBOX_OAUTH_REDIRECT_URL). Throws, naming the variable, when one is missing.
 */
export function getPayboxServer(): PayboxServer {
  const state = (slot.__hakoPaybox ??= {});
  if (state.server) return state.server;
  const env = loadWebEnv();
  if (!env.REDIS_URL) throw new Error("REDIS_URL is not set: PayBox token refreshes need the per-user Redis lock.");
  state.redis ??= new Redis(env.REDIS_URL);
  state.redis.on("error", (error: Error) => console.warn(`[hako-paybox] redis: ${error.message}`));
  state.server = createPayboxServer({
    pool: webPool(),
    redis: state.redis,
    encryptionKey: env.HAKO_TOKEN_ENCRYPTION_KEY,
    redirectUri: env.PAYBOX_OAUTH_REDIRECT_URL,
  });
  return state.server;
}
