import type { IntentState } from "@hako/cards/contract";

import type { Queryable } from "./pool.ts";
import type { Surface } from "./shared.ts";

/**
 * Draft kinds as the `drafts.kind` CHECK constraint lists them. @hako/paybox's `DraftKind` (the money-intent
 * contract) is asserted equal to this list at compile time, so the two never drift.
 */
export const DRAFT_KINDS = ["send", "swap", "bridge", "earn_deposit", "earn_withdraw", "run", "invoice_pay"] as const;
export type DraftKindName = (typeof DRAFT_KINDS)[number];

/** The PayBox core tool a version's request is created with (`drafts.request_kind`). */
export const DRAFT_REQUEST_KINDS = ["transfer", "wallet_sign", "use_service"] as const;
export type DraftRequestKind = (typeof DRAFT_REQUEST_KINDS)[number];

/** One version of a draft; input, quote and rehearsal are JSON the money intents own. */
export interface DraftRow<Input = unknown, Quote = unknown, Rehearsal = unknown> {
  draftId: string;
  version: number;
  kind: DraftKindName;
  state: IntentState;
  input: Input;
  quote: Quote | null;
  rehearsal: Rehearsal | null;
  surface: Surface | null;
  /** Set when this version was claimed for execution. */
  userId: string | null;
  requestKind: DraftRequestKind | null;
  /** The one PayBox request for this version, once PayBox answered. */
  payboxRequestId: string | null;
  /** The PayBox client that minted the request (only it can read the request back). */
  clientId: string | null;
  executedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewDraft {
  draftId: string;
  kind: DraftKindName;
  state: IntentState;
  input: unknown;
  quote?: unknown;
  rehearsal?: unknown;
  surface?: Surface | null;
}

export interface DraftVersionContent {
  state: IntentState;
  input: unknown;
  quote?: unknown;
  rehearsal?: unknown;
}

const COLUMNS = `draft_id as "draftId", version, kind, state, input, quote, rehearsal, surface, user_id as "userId",
  request_kind as "requestKind", paybox_request_id as "payboxRequestId", client_id as "clientId",
  executed_at as "executedAt", created_at as "createdAt", updated_at as "updatedAt"`;

const json = (value: unknown): string | null => (value === undefined || value === null ? null : JSON.stringify(value));

/** Inserts version 1; null when a draft with this id already exists. */
export async function insertDraft(q: Queryable, draft: NewDraft): Promise<DraftRow | null> {
  const { rows } = await q.query<DraftRow>(
    `insert into drafts (draft_id, version, kind, state, input, quote, rehearsal, surface)
     values ($1, 1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7) on conflict do nothing returning ${COLUMNS}`,
    [draft.draftId, draft.kind, draft.state, JSON.stringify(draft.input), json(draft.quote), json(draft.rehearsal), draft.surface ?? null],
  );
  return rows[0] ?? null;
}

/** The latest version, or null for an unknown id. */
export async function getLatestDraft(q: Queryable, draftId: string): Promise<DraftRow | null> {
  const { rows } = await q.query<DraftRow>(`select ${COLUMNS} from drafts where draft_id = $1 order by version desc limit 1`, [draftId]);
  return rows[0] ?? null;
}

export async function getDraftVersion(q: Queryable, draftId: string, version: number): Promise<DraftRow | null> {
  const { rows } = await q.query<DraftRow>(`select ${COLUMNS} from drafts where draft_id = $1 and version = $2`, [draftId, version]);
  return rows[0] ?? null;
}

/**
 * Stores `next` as version `expectedVersion + 1`, keeping the kind and surface; null when `expectedVersion` is not
 * the latest any more (another edit got there first) — the primary key settles a race between two edits.
 */
export async function appendDraftVersion(q: Queryable, draftId: string, expectedVersion: number, next: DraftVersionContent): Promise<DraftRow | null> {
  const { rows } = await q.query<DraftRow>(
    `insert into drafts (draft_id, version, kind, state, input, quote, rehearsal, surface)
     select draft_id, version + 1, kind, $3, $4::jsonb, $5::jsonb, $6::jsonb, surface from drafts
     where draft_id = $1 and version = $2 and version = (select max(version) from drafts where draft_id = $1)
     on conflict do nothing returning ${COLUMNS}`,
    [draftId, expectedVersion, next.state, JSON.stringify(next.input), json(next.quote), json(next.rehearsal)],
  );
  return rows[0] ?? null;
}

/**
 * Moves the latest version's state from `from` to `to`; false when the state is no longer `from`. The caller checks
 * `canTransition(from, to)` (@hako/cards/contract) first.
 */
export async function setDraftState(q: Queryable, draftId: string, from: IntentState, to: IntentState): Promise<boolean> {
  const { rowCount } = await q.query(
    `update drafts set state = $3, updated_at = now()
     where draft_id = $1 and state = $2 and version = (select max(version) from drafts where draft_id = $1)`,
    [draftId, from, to],
  );
  return rowCount === 1;
}

/**
 * Claims a version for execution before any PayBox request exists (plan §1 "One PayBox request per draft version"):
 * the first caller gets `created: true`; every later caller gets the row already claimed with `created: false`.
 * Null when the version doesn't exist.
 */
export async function claimDraftExecution(
  q: Queryable,
  claim: { draftId: string; version: number; userId: string; requestKind: DraftRequestKind },
): Promise<{ row: DraftRow; created: boolean } | null> {
  const { rows } = await q.query<DraftRow>(
    `update drafts set user_id = $3, request_kind = $4, executed_at = now(), updated_at = now()
     where draft_id = $1 and version = $2 and executed_at is null returning ${COLUMNS}`,
    [claim.draftId, claim.version, claim.userId, claim.requestKind],
  );
  if (rows[0]) return { row: rows[0], created: true };
  const existing = await getDraftVersion(q, claim.draftId, claim.version);
  return existing ? { row: existing, created: false } : null;
}

/** Stores the PayBox request id on a claimed version, once; false when it was already set (never overwritten). */
export async function recordDraftRequest(q: Queryable, draftId: string, version: number, requestId: string, clientId: string): Promise<boolean> {
  const { rowCount } = await q.query(
    `update drafts set paybox_request_id = $3, client_id = $4, updated_at = now()
     where draft_id = $1 and version = $2 and executed_at is not null and paybox_request_id is null`,
    [draftId, version, requestId, clientId],
  );
  return rowCount === 1;
}

/** The claimed version (its execution row), or null when that version was never claimed. */
export async function getDraftExecution(q: Queryable, draftId: string, version: number): Promise<DraftRow | null> {
  const { rows } = await q.query<DraftRow>(`select ${COLUMNS} from drafts where draft_id = $1 and version = $2 and executed_at is not null`, [draftId, version]);
  return rows[0] ?? null;
}

export async function findDraftByRequestId(q: Queryable, requestId: string): Promise<DraftRow | null> {
  const { rows } = await q.query<DraftRow>(`select ${COLUMNS} from drafts where paybox_request_id = $1`, [requestId]);
  return rows[0] ?? null;
}

/**
 * Claimed versions still without a request id, claimed before `claimedBefore`: the calls whose outcome is unknown,
 * which reconciliation settles with `list_requests` before anything is created again.
 */
export async function listUnresolvedExecutions(q: Queryable, claimedBefore: Date, limit: number): Promise<DraftRow[]> {
  const { rows } = await q.query<DraftRow>(
    `select ${COLUMNS} from drafts where executed_at is not null and paybox_request_id is null and executed_at < $1
     order by executed_at limit $2`,
    [claimedBefore, limit],
  );
  return rows;
}
