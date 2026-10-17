/**
 * One object that wires @hako/paybox for a server process (the web server through the package root, the gateway
 * through `@hako/paybox/node`): the encrypted token store, Connect PayBox, and PayBox sessions per Hako user.
 */
import type { Pool } from "@hako/db/node";
import type { Redis } from "ioredis";

import { createPayboxCaller, type ServerPayboxCaller } from "./caller.ts";
import { createPayboxConnect, type PayboxConnect } from "./connect.ts";
import { createTokenCipher } from "./crypto.ts";
import { createPayboxMcpSession, type PayboxMcpSession, type SigningSurface } from "./mcp.ts";
import type { Fetch } from "./oauth.ts";
import { createPayboxTokenStore, type PayboxTokenStore } from "./token-store.ts";
import { createPayboxTools, type PayboxTools } from "./tools.ts";

export interface PayboxServerSettings {
  pool: Pool;
  redis: Redis;
  /** HAKO_TOKEN_ENCRYPTION_KEY (64 hex). */
  encryptionKey: string | undefined;
  /** PAYBOX_OAUTH_REDIRECT_URL. */
  redirectUri: string;
  signingSurface?: SigningSurface;
  fetch?: Fetch;
}

export interface PayboxUserSession {
  /** The user's per-user PayBox client. */
  clientId: string;
  session: PayboxMcpSession;
  tools: PayboxTools;
  caller: ServerPayboxCaller;
}

export interface PayboxServer {
  tokens: PayboxTokenStore;
  connect: PayboxConnect;
  /** A PayBox session for a connected user (throws PayboxNotConnectedError otherwise); it closes itself when idle. */
  sessionFor(userId: string): Promise<PayboxUserSession>;
  /** The money intents' `payboxFor(userId)` (MoneyIntentDeps). */
  payboxFor(userId: string): Promise<ServerPayboxCaller>;
  /** Disconnect: drops the stored tokens; the user revokes the grant in PayBox's Clients screen. */
  disconnect(userId: string): Promise<boolean>;
}

export function createPayboxServer(settings: PayboxServerSettings): PayboxServer {
  const tokens = createPayboxTokenStore({ pool: settings.pool, redis: settings.redis, cipher: createTokenCipher(settings.encryptionKey), fetch: settings.fetch });
  const connect = createPayboxConnect({ pool: settings.pool, redis: settings.redis, store: tokens, redirectUri: settings.redirectUri, fetch: settings.fetch });

  async function sessionFor(userId: string): Promise<PayboxUserSession> {
    const { clientId } = await tokens.access(userId);
    const session = createPayboxMcpSession({
      accessToken: async () => (await tokens.access(userId)).accessToken,
      signingSurface: settings.signingSurface,
      fetch: settings.fetch,
    });
    const tools = createPayboxTools(session);
    return { clientId, session, tools, caller: createPayboxCaller(tools, clientId) };
  }

  return {
    tokens,
    connect,
    sessionFor,
    payboxFor: async (userId) => (await sessionFor(userId)).caller,
    disconnect: (userId) => tokens.disconnect(userId, "disconnected by the user"),
  };
}
