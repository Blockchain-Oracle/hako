/**
 * `POST /v1/receipts` (`hako_receipt {chain, txHash}`, plan §1 "If SP4 fails"): a transfer the user's own PayBox
 * connector sent (`request_transfer`) is closed by checking the transaction on chain (the chain tx connector in
 * hako-api, the same one `/v1/chain/tx` reads) and recording it as the caller's receipt.
 */

import type { z } from "zod";

import { READ_ALIAS_CONNECTORS, type receiptCreateRequestSchema, runEnvelopeSchema, txReceiptDataSchema } from "@hako/cards/contract";
import { getDraftVersion, getListedReceipt, type ListedReceipt, recordReceipt, type ReceiptStatus, updateReceipt } from "@hako/db/node";
import { sameAddress } from "@hako/money";
import { networkByCaip2 } from "@hako/networks";

import { HTTP_OK } from "../../constants.js";
import type { X402Context } from "./context.js";

const txEnvelopeSchema = runEnvelopeSchema(txReceiptDataSchema);

const STATUS: Record<"success" | "reverted" | "pending", ReceiptStatus> = { success: "confirmed", reverted: "failed", pending: "pending" };

export type OnchainReceipt =
  | { ok: true; receipt: ListedReceipt }
  | { ok: false; reason: "unsupported_chain" | "unknown_draft" | "tx_not_found" | "chain_unavailable" | "recorded_by_another_account"; message: string };

export async function recordOnchainReceipt(ctx: X402Context, userId: string, input: z.output<typeof receiptCreateRequestSchema>): Promise<OnchainReceipt> {
  const pool = ctx.pool!;
  const network = networkByCaip2(input.chain);
  if (!network) return { ok: false, reason: "unsupported_chain", message: `Hako doesn't read ${input.chain}.` };
  if (input.draft) {
    const draft = await getDraftVersion(pool, input.draft.draftId, input.draft.version);
    if (!draft || (draft.userId && draft.userId !== userId)) {
      return { ok: false, reason: "unknown_draft", message: `no draft ${input.draft.draftId} v${input.draft.version} of yours` };
    }
  }
  let forwarded;
  try {
    forwarded = await ctx.api.run(READ_ALIAS_CONNECTORS.chainTx[network.family], JSON.stringify({ chain: network.caip2, hash: input.txHash }));
  } catch (error) {
    return { ok: false, reason: "chain_unavailable", message: `The chain lookup could not be reached (${String(error)}).` };
  }
  const parseJson = (text: string): unknown => {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  };
  const envelope = forwarded.status === HTTP_OK ? txEnvelopeSchema.safeParse(parseJson(forwarded.body)) : null;
  if (!envelope?.success) return { ok: false, reason: "chain_unavailable", message: `The chain lookup answered HTTP ${forwarded.status}.` };
  const tx = txReceiptDataSchema.safeParse(envelope.data.data);
  if (!tx.success || tx.data.status === "not_found") {
    return { ok: false, reason: "tx_not_found", message: `${input.txHash} is not on ${network.name} (yet).` };
  }
  // What moved: the sender's token transfer, else the native value.
  const sender = tx.data.from;
  const transfer = tx.data.transfers?.find((t) => (sender ? sameAddress(t.from, sender) : true));
  const { receipt, created } = await recordReceipt(pool, {
    kind: "paybox_transfer",
    status: STATUS[tx.data.status],
    surface: "mcp",
    userId,
    chain: network.caip2,
    asset: transfer?.token ?? network.native.address,
    amountAtomic: transfer?.amount_atomic ?? tx.data.value_atomic ?? "0",
    payer: sender ?? null,
    payTo: transfer?.to ?? tx.data.to ?? null,
    txHash: input.txHash,
    draftId: input.draft?.draftId ?? null,
    draftVersion: input.draft?.version ?? null,
  });
  if (!created && receipt.userId !== userId) {
    return { ok: false, reason: "recorded_by_another_account", message: "This transaction is already another account's receipt." };
  }
  // Recorded while pending: asking again moves it on (confirmed or reverted).
  if (!created && receipt.status !== STATUS[tx.data.status]) await updateReceipt(pool, receipt.id, { status: STATUS[tx.data.status] });
  return { ok: true, receipt: (await getListedReceipt(pool, receipt.id))! };
}
