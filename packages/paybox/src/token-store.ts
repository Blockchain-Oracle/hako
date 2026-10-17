/**
 * The one encrypted PayBox token store, keyed by Hako user (plan §1 execution rules, §5b): tokens live in
 * `paybox_links` as AES-256-GCM ciphertext, and an access token with less than TOKEN_REFRESH_SKEW_S left is refreshed
 * under a per-user Redis lock (the refresh token rotates on every use; a replayed one revokes the client).
 */
import { MS_PER_SECOND, TOKEN_REFRESH_SKEW_S } from "@hako/config";
import { clearPayboxTokens, getActivePayboxLink, revokePayboxLink, savePayboxTokens, type PayboxLinkRow, type Pool } from "@hako/db/node";
import type { Redis } from "ioredis";

import type { TokenCipher } from "./crypto.ts";
import { withRedisLock } from "./lock.ts";
import { PayboxOAuthError, refreshPayboxTokens, type Fetch, type PayboxTokenSet } from "./oauth.ts";
import { REDIS_REFRESH_LOCK_PREFIX, REFRESH_LOCK_POLL_MS, REFRESH_LOCK_TTL_MS, REFRESH_LOCK_WAIT_MS } from "./paybox.config.ts";

/** The user has no active PayBox connection (never connected, disconnected, or not yet authorized). */
export class PayboxNotConnectedError extends Error {
  constructor(userId: string) {
    super(`Hako user ${userId} has not connected PayBox.`);
    this.name = "PayboxNotConnectedError";
  }
}

/** The stored grant can't be used (no refresh token, or PayBox refused the refresh): the user reconnects. */
export class PayboxReconnectRequiredError extends Error {
  constructor(reason: string) {
    super(`PayBox needs to be reconnected: ${reason}`);
    this.name = "PayboxReconnectRequiredError";
  }
}

/** The client was authorized by a different PayBox account than the one already linked to it. */
export class PayboxSubjectMismatchError extends Error {
  constructor() {
    super("This PayBox client is already linked to a different PayBox account.");
    this.name = "PayboxSubjectMismatchError";
  }
}

export interface PayboxAccess {
  accessToken: string;
  /** The per-user PayBox client: every request it mints is stored with it (only it can read the request back). */
  clientId: string;
  linkId: string;
}

export interface PayboxTokenStore {
  /** The user's active link (registered client, possibly not authorized yet). */
  link(userId: string): Promise<PayboxLinkRow | null>;
  /** Encrypts and stores a token set on the link (the first exchange, or a refresh). */
  save(link: PayboxLinkRow, tokens: PayboxTokenSet): Promise<PayboxLinkRow>;
  /** A usable access token, refreshed first when it has less than TOKEN_REFRESH_SKEW_S left. */
  access(userId: string): Promise<PayboxAccess>;
  /**
   * Disconnect: drops the stored tokens and keeps the per-user client (plan §1), so a reconnect authorizes the same
   * `client_id` and every request it minted stays readable. The grant itself is revoked in PayBox's Clients screen.
   */
  disconnect(userId: string): Promise<boolean>;
}

export interface TokenStoreDeps {
  pool: Pool;
  redis: Redis;
  cipher: TokenCipher;
  fetch?: Fetch;
  now?: () => Date;
}

/** The additional authenticated data a link's token is sealed with: user, link and column. */
const sealContext = (link: Pick<PayboxLinkRow, "userId" | "id">, column: "access" | "refresh") => `paybox:${link.userId}:${link.id}:${column}`;

export function createPayboxTokenStore(deps: TokenStoreDeps): PayboxTokenStore {
  const now = deps.now ?? (() => new Date());
  const skewMs = TOKEN_REFRESH_SKEW_S * MS_PER_SECOND;

  async function save(link: PayboxLinkRow, tokens: PayboxTokenSet): Promise<PayboxLinkRow> {
    if (link.sub && tokens.sub && link.sub !== tokens.sub) throw new PayboxSubjectMismatchError();
    // Keep the previous refresh token only when PayBox sent none (it always rotates when offline_access was granted).
    const refreshTokenEnc = tokens.refreshToken ? deps.cipher.encrypt(tokens.refreshToken, sealContext(link, "refresh")) : link.refreshTokenEnc;
    const saved = await savePayboxTokens(deps.pool, link.id, {
      accessTokenEnc: deps.cipher.encrypt(tokens.accessToken, sealContext(link, "access")),
      refreshTokenEnc,
      accessExpiresAt: tokens.expiresAt,
      scope: tokens.scope,
      sub: tokens.sub,
    });
    if (!saved) throw new PayboxReconnectRequiredError("the connection was revoked while it was being saved");
    return saved;
  }

  const fresh = (link: PayboxLinkRow): boolean =>
    link.accessTokenEnc !== null && link.accessExpiresAt !== null && link.accessExpiresAt.getTime() - now().getTime() > skewMs;

  const access = (link: PayboxLinkRow): PayboxAccess => ({
    accessToken: deps.cipher.decrypt(link.accessTokenEnc!, sealContext(link, "access")),
    clientId: link.clientId,
    linkId: link.id,
  });

  async function refresh(userId: string): Promise<PayboxAccess> {
    const lock = { ttlMs: REFRESH_LOCK_TTL_MS, waitMs: REFRESH_LOCK_WAIT_MS, pollMs: REFRESH_LOCK_POLL_MS };
    return withRedisLock(deps.redis, `${REDIS_REFRESH_LOCK_PREFIX}${userId}`, lock, async () => {
      // Another process may have refreshed while this one waited: re-read before spending the refresh token.
      const link = await getActivePayboxLink(deps.pool, userId);
      if (!link?.accessTokenEnc) throw new PayboxNotConnectedError(userId);
      if (fresh(link)) return access(link);
      if (!link.refreshTokenEnc) {
        // The client is still good: only a new authorization is needed, so the link keeps it.
        await clearPayboxTokens(deps.pool, link.id);
        throw new PayboxReconnectRequiredError("the access token expired and PayBox granted no refresh token");
      }
      let tokens: PayboxTokenSet;
      try {
        tokens = await refreshPayboxTokens({ clientId: link.clientId, refreshToken: deps.cipher.decrypt(link.refreshTokenEnc, sealContext(link, "refresh")) }, deps.fetch);
      } catch (error) {
        if (error instanceof PayboxOAuthError && error.revoked) {
          // invalid_client, or invalid_grant on a replayed refresh token (which revokes the client): a new one is needed.
          await revokePayboxLink(deps.pool, link.id, `refresh refused: ${error.code}`);
          throw new PayboxReconnectRequiredError(`PayBox refused the refresh (${error.code})`);
        }
        throw error;
      }
      return access(await save(link, tokens));
    });
  }

  return {
    link: (userId) => getActivePayboxLink(deps.pool, userId),
    save,
    async access(userId) {
      const link = await getActivePayboxLink(deps.pool, userId);
      if (!link?.accessTokenEnc) throw new PayboxNotConnectedError(userId);
      return fresh(link) ? access(link) : refresh(userId);
    },
    async disconnect(userId) {
      const link = await getActivePayboxLink(deps.pool, userId);
      return link ? clearPayboxTokens(deps.pool, link.id) : false;
    },
  };
}
