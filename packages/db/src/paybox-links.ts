import type { Queryable } from "./pool.ts";
import { isUniqueViolation, newId } from "./shared.ts";

/**
 * A Hako user's PayBox connection (plan §1 execution rules): the per-user public client and its tokens. Token
 * columns hold @hako/paybox's AES-256-GCM ciphertext, never a plaintext token. At most one link per user is
 * active; a revoked link stays as history (requests it minted can only be read by its client).
 */
export interface PayboxLinkRow {
  id: string;
  userId: string;
  clientId: string;
  redirectUri: string;
  sub: string | null;
  scope: string | null;
  accessTokenEnc: string | null;
  refreshTokenEnc: string | null;
  accessExpiresAt: Date | null;
  revokedAt: Date | null;
  revokedReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const COLUMNS = `id, user_id as "userId", client_id as "clientId", redirect_uri as "redirectUri", sub, scope,
  access_token_enc as "accessTokenEnc", refresh_token_enc as "refreshTokenEnc", access_expires_at as "accessExpiresAt",
  revoked_at as "revokedAt", revoked_reason as "revokedReason", created_at as "createdAt", updated_at as "updatedAt"`;

/** Stores a newly registered client for the user; null when the user already has an active link. */
export async function createPayboxLink(q: Queryable, input: { userId: string; clientId: string; redirectUri: string }): Promise<PayboxLinkRow | null> {
  try {
    const { rows } = await q.query<PayboxLinkRow>(
      `insert into paybox_links (id, user_id, client_id, redirect_uri) values ($1, $2, $3, $4) returning ${COLUMNS}`,
      [newId(), input.userId, input.clientId, input.redirectUri],
    );
    return rows[0] ?? null;
  } catch (error) {
    if (isUniqueViolation(error)) return null;
    throw error;
  }
}

/** The user's active link (registered client, possibly not yet authorized), or null. */
export async function getActivePayboxLink(q: Queryable, userId: string): Promise<PayboxLinkRow | null> {
  const { rows } = await q.query<PayboxLinkRow>(`select ${COLUMNS} from paybox_links where user_id = $1 and revoked_at is null`, [userId]);
  return rows[0] ?? null;
}

/** Same, inside a transaction, locking the row until it ends (the token refresh holds it while it writes). */
export async function lockActivePayboxLink(q: Queryable, userId: string): Promise<PayboxLinkRow | null> {
  const { rows } = await q.query<PayboxLinkRow>(`select ${COLUMNS} from paybox_links where user_id = $1 and revoked_at is null for update`, [userId]);
  return rows[0] ?? null;
}

export async function getPayboxLink(q: Queryable, id: string): Promise<PayboxLinkRow | null> {
  const { rows } = await q.query<PayboxLinkRow>(`select ${COLUMNS} from paybox_links where id = $1`, [id]);
  return rows[0] ?? null;
}

export interface PayboxTokenUpdate {
  accessTokenEnc: string;
  refreshTokenEnc: string | null;
  accessExpiresAt: Date;
  scope: string | null;
  /** Set on the first exchange; a later value never replaces a different one (see `PayboxSubMismatch`). */
  sub?: string | null;
}

/** Saves a token pair on an active link; null when the link was revoked meanwhile. */
export async function savePayboxTokens(q: Queryable, linkId: string, tokens: PayboxTokenUpdate): Promise<PayboxLinkRow | null> {
  const { rows } = await q.query<PayboxLinkRow>(
    `update paybox_links set access_token_enc = $2, refresh_token_enc = $3, access_expires_at = $4, scope = $5,
       sub = coalesce(sub, $6), updated_at = now()
     where id = $1 and revoked_at is null returning ${COLUMNS}`,
    [linkId, tokens.accessTokenEnc, tokens.refreshTokenEnc, tokens.accessExpiresAt, tokens.scope, tokens.sub ?? null],
  );
  return rows[0] ?? null;
}

/** Revokes a link (Disconnect, a refused refresh, a revoked client): its tokens are dropped, the row stays. */
export async function revokePayboxLink(q: Queryable, linkId: string, reason: string): Promise<boolean> {
  const { rowCount } = await q.query(
    `update paybox_links set revoked_at = now(), revoked_reason = $2, access_token_enc = null, refresh_token_enc = null,
       access_expires_at = null, updated_at = now()
     where id = $1 and revoked_at is null`,
    [linkId, reason],
  );
  return rowCount === 1;
}

/** Active links carrying this PayBox subject (SP10: one account across clients, if PayBox keeps `sub` stable). */
export async function findActiveLinksBySub(q: Queryable, sub: string): Promise<PayboxLinkRow[]> {
  const { rows } = await q.query<PayboxLinkRow>(`select ${COLUMNS} from paybox_links where sub = $1 and revoked_at is null order by created_at`, [sub]);
  return rows;
}
