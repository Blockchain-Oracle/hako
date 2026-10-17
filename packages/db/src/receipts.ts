import type { ReceiptKind as CardReceiptKind } from "@hako/cards/contract";
import type { AtomicString } from "@hako/defi/core";

import type { Queryable } from "./pool.ts";
import { cursorParams, newId, pageLimit, type PageOptions, type Surface } from "./shared.ts";

/**
 * What a receipt records (plan add-ons, Activity ledger): an x402 settlement the gateway saw (paid runs, batches,
 * invoice payments, including plugin payments from other hosts), a LI.FI move (bridge, swap, earn) or a PayBox
 * transfer (a send).
 */
export const RECEIPT_KINDS = ["x402_settlement", "lifi_move", "paybox_transfer"] as const;
export type ReceiptKind = (typeof RECEIPT_KINDS)[number];

/** pending until confirmed on-chain (a LI.FI move: until the destination arrived), or failed. */
export const RECEIPT_STATUSES = ["pending", "confirmed", "failed"] as const;
export type ReceiptStatus = (typeof RECEIPT_STATUSES)[number];

export interface ReceiptRow {
  id: string;
  kind: ReceiptKind;
  status: ReceiptStatus;
  surface: Surface;
  userId: string | null;
  chain: string;
  asset: string;
  amountAtomic: AtomicString;
  payer: string | null;
  payTo: string | null;
  txHash: string | null;
  toChain: string | null;
  toAsset: string | null;
  toAmountAtomic: AtomicString | null;
  destTxHash: string | null;
  lifiTool: string | null;
  toolId: string | null;
  batchId: string | null;
  invoiceId: string | null;
  payboxRequestId: string | null;
  payboxClientId: string | null;
  draftId: string | null;
  draftVersion: number | null;
  feeUsd: string | null;
  isPublic: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** Required fields plus whatever the recording surface knows. */
export type NewReceipt = Pick<ReceiptRow, "kind" | "status" | "surface" | "chain" | "asset" | "amountAtomic"> &
  Partial<Omit<ReceiptRow, "id" | "kind" | "status" | "surface" | "chain" | "asset" | "amountAtomic" | "createdAt" | "updatedAt">>;

/** The CAIP-2 namespace of EVM chains, whose transaction hashes are hex. */
const EVM_CHAIN_PREFIX = "eip155:";

/**
 * The one spelling of a transaction hash on `chain`: EVM hashes are hex, so `0xAB…` and `0xab…` are the same
 * transaction and are stored lowercase (0003_keyset_paging.sql checks it); Solana signatures are base58, where case
 * is part of the value, and stay as given.
 */
const canonicalTxHash = (chain: string, hash: string): string => (chain.startsWith(EVM_CHAIN_PREFIX) ? hash.toLowerCase() : hash);

const COLUMNS = `id, kind, status, surface, user_id as "userId", chain, asset, amount_atomic::text as "amountAtomic",
  payer, pay_to as "payTo", tx_hash as "txHash", to_chain as "toChain", to_asset as "toAsset",
  to_amount_atomic::text as "toAmountAtomic", dest_tx_hash as "destTxHash", lifi_tool as "lifiTool",
  tool_id as "toolId", batch_id as "batchId", invoice_id as "invoiceId", paybox_request_id as "payboxRequestId",
  paybox_client_id as "payboxClientId", draft_id as "draftId", draft_version as "draftVersion",
  fee_usd::text as "feeUsd", is_public as "isPublic", created_at as "createdAt", updated_at as "updatedAt"`;

/**
 * Records a receipt once. A second call for the same settlement transaction (kind, chain, tx hash) or the same
 * PayBox request returns the row already there and changes nothing, so retries and replays are harmless.
 */
export async function recordReceipt(q: Queryable, input: NewReceipt): Promise<{ receipt: ReceiptRow; created: boolean }> {
  const txHash = input.txHash ? canonicalTxHash(input.chain, input.txHash) : null;
  const destTxHash = input.destTxHash ? canonicalTxHash(input.toChain ?? input.chain, input.destTxHash) : null;
  const { rows } = await q.query<ReceiptRow>(
    `insert into receipts (id, kind, status, surface, user_id, chain, asset, amount_atomic, payer, pay_to, tx_hash,
       to_chain, to_asset, to_amount_atomic, dest_tx_hash, lifi_tool, tool_id, batch_id, invoice_id,
       paybox_request_id, paybox_client_id, draft_id, draft_version, fee_usd, is_public)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25)
     on conflict do nothing returning ${COLUMNS}`,
    [
      newId(), input.kind, input.status, input.surface, input.userId ?? null, input.chain, input.asset, input.amountAtomic,
      input.payer ?? null, input.payTo ?? null, txHash, input.toChain ?? null, input.toAsset ?? null,
      input.toAmountAtomic ?? null, destTxHash, input.lifiTool ?? null, input.toolId ?? null,
      input.batchId ?? null, input.invoiceId ?? null, input.payboxRequestId ?? null, input.payboxClientId ?? null,
      input.draftId ?? null, input.draftVersion ?? null, input.feeUsd ?? null, input.isPublic ?? false,
    ],
  );
  if (rows[0]) return { receipt: rows[0], created: true };
  const existing =
    (input.payboxRequestId ? await findReceiptByRequestId(q, input.payboxRequestId) : null) ??
    (txHash ? await findReceiptByTx(q, input.kind, input.chain, txHash) : null);
  if (!existing) throw new Error("recordReceipt: the insert conflicted but no matching receipt was found");
  return { receipt: existing, created: false };
}

export async function getReceipt(q: Queryable, id: string): Promise<ReceiptRow | null> {
  const { rows } = await q.query<ReceiptRow>(`select ${COLUMNS} from receipts where id = $1`, [id]);
  return rows[0] ?? null;
}

export async function findReceiptByRequestId(q: Queryable, payboxRequestId: string): Promise<ReceiptRow | null> {
  const { rows } = await q.query<ReceiptRow>(`select ${COLUMNS} from receipts where paybox_request_id = $1`, [payboxRequestId]);
  return rows[0] ?? null;
}

/** The receipt of one settlement transaction (an EVM hash matches in any case). */
export async function findReceiptByTx(q: Queryable, kind: ReceiptKind, chain: string, txHash: string): Promise<ReceiptRow | null> {
  const { rows } = await q.query<ReceiptRow>(`select ${COLUMNS} from receipts where kind = $1 and chain = $2 and tx_hash = $3`, [
    kind,
    chain,
    canonicalTxHash(chain, txHash),
  ]);
  return rows[0] ?? null;
}

export interface ReceiptUpdate {
  status?: ReceiptStatus;
  txHash?: string;
  destTxHash?: string;
  toAmountAtomic?: AtomicString;
  feeUsd?: string;
  isPublic?: boolean;
}

/**
 * Moves a receipt forward (pending → confirmed/failed, the destination hash once LI.FI reports it). Hashes are
 * stored in their one spelling for the row's chain (the destination's for `destTxHash`), as `recordReceipt` does.
 */
export async function updateReceipt(q: Queryable, id: string, update: ReceiptUpdate): Promise<ReceiptRow | null> {
  const { rows } = await q.query<ReceiptRow>(
    `update receipts set
       status = coalesce($2, status),
       tx_hash = coalesce(case when starts_with(chain, $8::text) then lower($3::text) else $3::text end, tx_hash),
       dest_tx_hash = coalesce(case when starts_with(coalesce(to_chain, chain), $8::text) then lower($4::text) else $4::text end, dest_tx_hash),
       to_amount_atomic = coalesce($5, to_amount_atomic), fee_usd = coalesce($6, fee_usd),
       is_public = coalesce($7, is_public), updated_at = now()
     where id = $1 returning ${COLUMNS}`,
    [
      id, update.status ?? null, update.txHash ?? null, update.destTxHash ?? null, update.toAmountAtomic ?? null,
      update.feeUsd ?? null, update.isPublic ?? null, EVM_CHAIN_PREFIX,
    ],
  );
  return rows[0] ?? null;
}

/** The user's own receipts, newest first. */
export async function listReceiptsForUser(q: Queryable, userId: string, page: PageOptions = {}): Promise<ReceiptRow[]> {
  const { rows } = await q.query<ReceiptRow>(
    `select ${COLUMNS} from receipts where user_id = $1 and ($2::timestamptz is null or (created_at, id) < ($2::timestamptz, $3::text))
     order by created_at desc, id desc limit $4`,
    [userId, ...cursorParams(page), pageLimit(page.limit)],
  );
  return rows;
}

/**
 * Receipts paid from or to any of these addresses (the connected user's PayBox wallets): plugin payments made in
 * other hosts and invoices paid to them carry no Hako account, so Activity matches them by address.
 */
export async function listReceiptsForAddresses(q: Queryable, addresses: readonly string[], page: PageOptions = {}): Promise<ReceiptRow[]> {
  if (addresses.length === 0) return [];
  const { rows } = await q.query<ReceiptRow>(
    `select ${COLUMNS} from receipts
     where (lower(payer) = any($1::text[]) or lower(pay_to) = any($1::text[]))
       and ($2::timestamptz is null or (created_at, id) < ($2::timestamptz, $3::text))
     order by created_at desc, id desc limit $4`,
    [addresses.map((address) => address.toLowerCase()), ...cursorParams(page), pageLimit(page.limit)],
  );
  return rows;
}

/** Shared receipts (`/r/<id>`, the landing proof), newest first. */
export async function listPublicReceipts(q: Queryable, page: PageOptions = {}): Promise<ReceiptRow[]> {
  const { rows } = await q.query<ReceiptRow>(
    `select ${COLUMNS} from receipts where is_public and ($1::timestamptz is null or (created_at, id) < ($1::timestamptz, $2::text))
     order by created_at desc, id desc limit $3`,
    [...cursorParams(page), pageLimit(page.limit)],
  );
  return rows;
}

/**
 * What a receipt is in the Activity ledger: the receipt kinds of the card contract. An x402 settlement is a run, a
 * batch or an invoice payment; a PayBox transfer is a send; a LI.FI move takes its draft's kind (swap, bridge, Earn
 * deposit or withdraw), else bridge when it changed chains and swap when it didn't.
 */
export type ActivityKind = CardReceiptKind;
export interface ListedReceipt extends ReceiptRow {
  activityKind: ActivityKind;
}

const ACTIVITY_KIND = `case
    when kind = 'x402_settlement' then case when invoice_id is not null then 'invoice' when batch_id is not null then 'batch' else 'run' end
    when kind = 'paybox_transfer' then 'send'
    else coalesce(
      (select d.kind from drafts d where d.draft_id = receipts.draft_id and d.version = receipts.draft_version
        and d.kind in ('swap', 'bridge', 'earn_deposit', 'earn_withdraw')),
      case when to_chain is not null and to_chain <> chain then 'bridge' else 'swap' end)
  end`;

/** Whose receipts a list reads: one user's own, or the ones their owners shared (`/r/<id>`, the landing proof). */
export type ReceiptScope = { userId: string } | "public";

/** The Activity filters (plan D23: type, status, chain, surface) and a draft, so a confirmed move's card finds its receipt. */
export interface ReceiptFilter {
  activityKind?: ActivityKind;
  status?: ReceiptStatus;
  chain?: string;
  surface?: Surface;
  draftId?: string;
}

/** A scope's receipts with the Activity filters, newest first, each with its Activity kind. */
export async function listReceipts(q: Queryable, scope: ReceiptScope, filter: ReceiptFilter = {}, page: PageOptions = {}): Promise<ListedReceipt[]> {
  const { rows } = await q.query<ListedReceipt>(
    `select * from (
       select ${COLUMNS}, ${ACTIVITY_KIND} as "activityKind" from receipts
       where ($1::text is null or user_id = $1) and (not $2::boolean or is_public)
         and ($3::text is null or status = $3) and ($4::text is null or chain = $4)
         and ($5::text is null or surface = $5) and ($6::text is null or draft_id = $6)
         and ($7::timestamptz is null or (created_at, id) < ($7::timestamptz, $8::text))
     ) listed
     where ($9::text is null or "activityKind" = $9)
     order by "createdAt" desc, id desc limit $10`,
    [
      scope === "public" ? null : scope.userId, scope === "public", filter.status ?? null, filter.chain ?? null,
      filter.surface ?? null, filter.draftId ?? null, ...cursorParams(page), filter.activityKind ?? null, pageLimit(page.limit),
    ],
  );
  return rows;
}

/** One receipt with its Activity kind. */
export async function getListedReceipt(q: Queryable, id: string): Promise<ListedReceipt | null> {
  const { rows } = await q.query<ListedReceipt>(`select ${COLUMNS}, ${ACTIVITY_KIND} as "activityKind" from receipts where id = $1`, [id]);
  return rows[0] ?? null;
}
