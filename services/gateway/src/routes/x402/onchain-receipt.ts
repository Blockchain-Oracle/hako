/**
 * `POST /v1/receipts` (`hako_receipt {chain, txHash, draft}`, plan §1 "If SP4 fails"): a send the user's own PayBox
 * connector made (`request_transfer`) is closed by checking the transaction on chain (the chain tx connector in
 * hako-api, the same one `/v1/chain/tx` reads) against the caller's send draft, and recording it as their receipt.
 * The transaction must be the draft's send — from its sender, to its recipient, that token and amount — so nobody can
 * record someone else's transfer as their own (receipts are unique per transaction: the first to record one owns it).
 */

import { z } from "zod";

import {
  atomicSchema,
  caip2Schema,
  READ_ALIAS_CONNECTORS,
  type receiptCreateRequestSchema,
  runEnvelopeSchema,
  txReceiptDataSchema,
} from "@hako/cards/contract";
import { claimDraftExecution, getDraftVersion, getListedReceipt, type ListedReceipt, recordReceipt, type ReceiptStatus, updateReceipt } from "@hako/db/node";
import { sameAddress } from "@hako/money";
import { networkByCaip2 } from "@hako/networks";

import { HTTP_OK } from "../../constants.js";
import type { X402Context } from "./context.js";

const txEnvelopeSchema = runEnvelopeSchema(txReceiptDataSchema);
type TxReceipt = z.output<typeof txReceiptDataSchema>;

/** The fields of a send draft's stored input (@hako/paybox `SendInput`) that a receipt binds: chain, token, amount, from, to. */
const sendDraftInputSchema = z.object({
  chain: caip2Schema,
  token: z.string().min(1),
  amountAtomic: atomicSchema,
  from: z.string().min(1),
  to: z.string().min(1),
});
type SendDraftInput = z.output<typeof sendDraftInputSchema>;

const STATUS: Record<"success" | "reverted" | "pending", ReceiptStatus> = { success: "confirmed", reverted: "failed", pending: "pending" };

export type OnchainReceiptRefusal =
  | "unsupported_chain"
  | "draft_required"
  | "unknown_draft"
  | "not_a_send_draft"
  | "tx_not_found"
  | "tx_mismatch"
  | "tx_pending"
  | "chain_unavailable"
  | "recorded_by_another_account";

export type OnchainReceipt = { ok: true; receipt: ListedReceipt } | { ok: false; reason: OnchainReceiptRefusal; message: string };

const refused = (reason: OnchainReceiptRefusal, message: string): OnchainReceipt => ({ ok: false, reason, message });

interface Sent {
  asset: string;
  amountAtomic: string;
  payTo: string;
}

/**
 * What the transaction moved, when it is the draft's send; "pending" when a token send has no logs to check yet; null
 * when it is some other transaction. A reverted token send has no transfer logs: it counts when its sender called the
 * draft's token contract, and is recorded as failed (nothing moved).
 */
export function sentAsDrafted(tx: TxReceipt, send: SendDraftInput, nativeAddress: string): Sent | "pending" | null {
  if (!tx.from || !sameAddress(tx.from, send.from)) return null;
  const drafted: Sent = { asset: send.token, amountAtomic: send.amountAtomic, payTo: send.to };
  if (sameAddress(send.token, nativeAddress)) {
    return tx.to && sameAddress(tx.to, send.to) && tx.value_atomic === send.amountAtomic ? drafted : null;
  }
  const transfer = tx.transfers?.find(
    (t) => sameAddress(t.token, send.token) && sameAddress(t.from, send.from) && sameAddress(t.to, send.to) && t.amount_atomic === send.amountAtomic,
  );
  if (transfer) return drafted;
  const calledToken = tx.to !== undefined && sameAddress(tx.to, send.token) && !tx.transfers?.length;
  if (calledToken && tx.status === "pending") return "pending";
  if (calledToken && tx.status === "reverted") return drafted;
  return null;
}

type FoundTx = TxReceipt & { status: keyof typeof STATUS };
type TxRead = { ok: true; tx: FoundTx } | Extract<OnchainReceipt, { ok: false }>;

/** The transaction through hako-api's chain tx connector (`connector` = `chain-evm/tx` or `chain-solana/tx`). */
async function readTx(ctx: X402Context, connector: string, chain: string, hash: string): Promise<TxRead> {
  let forwarded;
  try {
    forwarded = await ctx.api.run(connector, JSON.stringify({ chain, hash }));
  } catch (error) {
    return { ok: false, reason: "chain_unavailable", message: `The chain lookup could not be reached (${String(error)}).` };
  }
  let body: unknown = null;
  try {
    body = JSON.parse(forwarded.body);
  } catch {
    body = null;
  }
  const envelope = forwarded.status === HTTP_OK ? txEnvelopeSchema.safeParse(body) : null;
  if (!envelope?.success) return { ok: false, reason: "chain_unavailable", message: `The chain lookup answered HTTP ${forwarded.status}.` };
  const tx = txReceiptDataSchema.safeParse(envelope.data.data);
  if (!tx.success || tx.data.status === "not_found") return { ok: false, reason: "tx_not_found", message: `${hash} is not on that chain (yet).` };
  return { ok: true, tx: tx.data as FoundTx };
}

export async function recordOnchainReceipt(ctx: X402Context, userId: string, input: z.output<typeof receiptCreateRequestSchema>): Promise<OnchainReceipt> {
  const pool = ctx.pool!;
  const network = networkByCaip2(input.chain);
  if (!network) return refused("unsupported_chain", `Hako doesn't read ${input.chain}.`);
  if (!input.draft) return refused("draft_required", "A receipt closes a send draft: pass the draft id and version the transfer was made for.");
  const { draftId, version } = input.draft;
  const draft = await getDraftVersion(pool, draftId, version);
  if (!draft || (draft.userId && draft.userId !== userId)) return refused("unknown_draft", `no draft ${draftId} v${version} of yours`);
  const send = draft.kind === "send" ? sendDraftInputSchema.safeParse(draft.input) : null;
  if (!send?.success) return refused("not_a_send_draft", `Draft ${draftId} v${version} is not a send; only a send closes with a transaction receipt.`);
  if (send.data.chain !== network.caip2) return refused("tx_mismatch", `Draft ${draftId} v${version} sends on ${send.data.chain}, not ${network.caip2}.`);

  const read = await readTx(ctx, READ_ALIAS_CONNECTORS.chainTx[network.family], network.caip2, input.txHash);
  if (!read.ok) return read;
  const { tx } = read;
  const sent = sentAsDrafted(tx, send.data, network.native.address);
  if (sent === "pending") return refused("tx_pending", `${input.txHash} is not confirmed yet; ask again once it is.`);
  if (!sent) return refused("tx_mismatch", `${input.txHash} is not this draft's send (sender, recipient, token and amount must all match).`);

  // An unclaimed draft becomes the caller's now; one another account claimed first is not theirs.
  if (!draft.userId) {
    const claimed = await claimDraftExecution(pool, { draftId, version, userId, requestKind: "transfer" });
    if (!claimed || claimed.row.userId !== userId) return refused("unknown_draft", `no draft ${draftId} v${version} of yours`);
  }

  const { receipt, created } = await recordReceipt(pool, {
    kind: "paybox_transfer",
    status: STATUS[tx.status],
    surface: "mcp",
    userId,
    chain: network.caip2,
    asset: sent.asset,
    amountAtomic: sent.amountAtomic,
    payer: send.data.from,
    payTo: sent.payTo,
    txHash: input.txHash,
    draftId,
    draftVersion: version,
  });
  if (!created && receipt.userId !== userId) {
    return refused("recorded_by_another_account", "This transaction is already another account's receipt.");
  }
  // Recorded while pending: asking again moves it on (confirmed or reverted).
  if (!created && receipt.status !== STATUS[tx.status]) await updateReceipt(pool, receipt.id, { status: STATUS[tx.status] });
  return { ok: true, receipt: (await getListedReceipt(pool, receipt.id))! };
}
