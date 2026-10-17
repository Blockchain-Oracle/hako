/**
 * Connect PayBox (plan §1 execution rules, D22): the first connect registers one public PayBox client for the Hako
 * user and stores its `client_id`; every reconnect reuses it (a new client only after a revocation). `begin` returns
 * the PKCE S256 authorize URL and parks the verifier in Redis under the state; `finish` (the callback) takes it back
 * once, checks it belongs to the signed-in user, exchanges the code and stores the encrypted tokens.
 */
import { createPayboxLink, getActivePayboxLink, getPayboxLink, revokePayboxLink, type PayboxLinkRow, type Pool } from "@hako/db/node";
import type { Redis } from "ioredis";

import { createOAuthState, createPkce, exchangePayboxCode, payboxAuthorizeUrl, registerPayboxClient, type Fetch } from "./oauth.ts";
import { CONNECT_PENDING_TTL_S, REDIS_CONNECT_PREFIX } from "./paybox.config.ts";
import type { PayboxTokenStore } from "./token-store.ts";

/** The callback's state is unknown, expired, used, or belongs to another user. */
export class PayboxConnectStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PayboxConnectStateError";
  }
}

interface PendingConnect {
  userId: string;
  linkId: string;
  verifier: string;
}

export interface PayboxConnect {
  /** Starts Connect PayBox for a signed-in Hako user: the URL to open, and the user's per-user client id. */
  begin(userId: string): Promise<{ authorizeUrl: string; clientId: string }>;
  /** Completes it from the callback's `state` and `code`, for the same signed-in user. */
  finish(input: { userId: string; state: string; code: string }): Promise<PayboxLinkRow>;
}

export interface ConnectDeps {
  pool: Pool;
  redis: Redis;
  store: PayboxTokenStore;
  /** PAYBOX_OAUTH_REDIRECT_URL: registered with each per-user client and matched exactly by PayBox. */
  redirectUri: string;
  fetch?: Fetch;
}

export function createPayboxConnect(deps: ConnectDeps): PayboxConnect {
  /** The user's active client, registering one at first connect (or after a revocation, or a changed redirect). */
  async function clientFor(userId: string): Promise<PayboxLinkRow> {
    const existing = await getActivePayboxLink(deps.pool, userId);
    if (existing && existing.redirectUri === deps.redirectUri) return existing;
    // PayBox matches redirect_uri exactly: a client registered for another redirect can never complete a callback.
    if (existing) await revokePayboxLink(deps.pool, existing.id, "the redirect URL changed");
    const clientId = await registerPayboxClient(deps.redirectUri, deps.fetch);
    const created = await createPayboxLink(deps.pool, { userId, clientId, redirectUri: deps.redirectUri });
    if (created) return created;
    // Another request registered one at the same moment: use the stored one (this client_id is simply never used).
    const winner = await getActivePayboxLink(deps.pool, userId);
    if (!winner) throw new Error("Connect PayBox: the user's PayBox client could not be stored.");
    return winner;
  }

  return {
    async begin(userId) {
      const link = await clientFor(userId);
      const { verifier, challenge } = createPkce();
      const state = createOAuthState();
      const pending: PendingConnect = { userId, linkId: link.id, verifier };
      await deps.redis.set(`${REDIS_CONNECT_PREFIX}${state}`, JSON.stringify(pending), "EX", CONNECT_PENDING_TTL_S);
      return { authorizeUrl: payboxAuthorizeUrl({ clientId: link.clientId, redirectUri: link.redirectUri, state, challenge }), clientId: link.clientId };
    },

    async finish({ userId, state, code }) {
      const raw = await deps.redis.getdel(`${REDIS_CONNECT_PREFIX}${state}`);
      if (!raw) throw new PayboxConnectStateError("This PayBox sign-in expired or was already used. Start Connect PayBox again.");
      const pending = JSON.parse(raw) as PendingConnect;
      if (pending.userId !== userId) throw new PayboxConnectStateError("This PayBox sign-in was started by another Hako session.");
      const link = await getPayboxLink(deps.pool, pending.linkId);
      if (!link || link.revokedAt || link.userId !== userId) throw new PayboxConnectStateError("This PayBox connection was replaced. Start Connect PayBox again.");
      const tokens = await exchangePayboxCode({ clientId: link.clientId, redirectUri: link.redirectUri, code, verifier: pending.verifier }, deps.fetch);
      return deps.store.save(link, tokens);
    },
  };
}
