import {
  type CardPhase,
  draftRefSchema,
  type ReceiptData,
  SIGNED_TX_MAX_CHARS,
  structuredContentSchema,
  type Suggestion,
  txHashSchema,
} from "@hako/cards/contract";
import { z } from "zod";

import { APP_ONLY, card, chip, defineTool, MODEL_AND_APP, MONEY, READ } from "../define.ts";
import { loadDraft } from "../draft-cards.ts";
import { chainInputSchema } from "../inputs.ts";
import { requireUser, txLink } from "../resolve.ts";
import { statusCard, txLinks } from "../status-cards.ts";

/**
 * Execution and its outcome (plan §1 execution rules): `hako_execute` creates the one PayBox request for a draft
 * version (a repeat returns the stored one), `hako_request_status` re-reads it, `hako_broadcast` hands a signed tx from
 * the user's own PayBox connector to Hako's broadcast checks, and `hako_receipt` records a transaction checked on chain.
 */

export const hakoExecute = defineTool({
  name: "hako_execute",
  title: "Pay or move with PayBox",
  description:
    "Runs one draft version with PayBox: pays a pay card or sends, swaps, bridges, deposits or withdraws exactly what " +
    "that version of the card shows. PayBox asks the person to approve; the card follows the request to its receipt. " +
    "Call it only for the draft id and version the person confirmed; calling it again returns the same request.",
  input: draftRefSchema,
  output: structuredContentSchema("status"),
  annotations: MONEY,
  visibility: MODEL_AND_APP,
  auth: "required",
  cardKinds: ["status"],
  async execute({ draftId, version }, deps) {
    const user = requireUser(deps, "hako_execute");
    const result = await deps.intents.executeDraft(draftId, version, user.id);
    const view = await loadDraft(deps, draftId);
    return statusCard(deps, {
      phase: result.phase,
      draftId: result.draftId,
      version: result.version,
      kind: view.kind,
      state: view.version === result.version ? view.state : null,
      requestId: result.requestId,
      requestStatus: result.status,
      approvalUrl: result.approvalUrl,
      txs: [],
      reason: null,
      reused: result.reused,
      receiptId: null,
    });
  },
});

export const hakoRequestStatus = defineTool({
  name: "hako_request_status",
  title: "Follow a payment or move",
  description: "App-only: re-reads a draft's PayBox request and transactions (never re-sends anything).",
  input: z.object({ draftId: z.string().min(1) }),
  output: structuredContentSchema("status"),
  annotations: READ,
  visibility: APP_ONLY,
  auth: "required",
  cardKinds: ["status"],
  async execute({ draftId }, deps) {
    requireUser(deps, "hako_request_status");
    const [status, view] = await Promise.all([deps.intents.readStatus(draftId), loadDraft(deps, draftId)]);
    return statusCard(deps, {
      phase: status.phase,
      draftId: status.draftId,
      version: status.version,
      kind: view.kind,
      state: status.state,
      requestId: status.requestId,
      requestStatus: status.requestStatus,
      approvalUrl: status.approvalUrl,
      txs: txLinks(view, status.txHashes),
      reason: status.reason,
      reused: false,
      receiptId: null,
    });
  },
});

export const hakoBroadcast = defineTool({
  name: "hako_broadcast",
  title: "Send a signed transaction",
  description:
    "Only for the hand-off when PayBox's signing window can't run in this host: pass the signed transaction PayBox's " +
    "request_wallet_sign returned (serializedTransaction or signedTransactionBase64) with the draft id and version it " +
    "was made for. Hako checks it equals that draft version and is still fresh, then sends it once; otherwise it is " +
    "refused and no money moves.",
  input: draftRefSchema.extend({
    chain: chainInputSchema,
    signedTx: z.string().min(1).max(SIGNED_TX_MAX_CHARS).describe("The signed transaction exactly as PayBox returned it"),
  }),
  output: structuredContentSchema("status"),
  annotations: MONEY,
  visibility: MODEL_AND_APP,
  auth: "required",
  cardKinds: ["status"],
  async execute(input, deps) {
    requireUser(deps, "hako_broadcast");
    const [sent, view] = await Promise.all([deps.gateway.call("broadcast", { body: input }), loadDraft(deps, input.draftId)]);
    const phase: CardPhase = sent.status === "refused" ? "error" : "live";
    return statusCard(deps, {
      phase,
      draftId: input.draftId,
      version: input.version,
      kind: view.kind,
      state: view.version === input.version ? view.state : null,
      requestId: null,
      requestStatus: null,
      approvalUrl: null,
      txs: sent.txHash ? [txLink(input.chain, sent.txHash, "source")] : [],
      reason: sent.reason,
      reused: sent.status === "already_known",
      receiptId: null,
    });
  },
});

const PHASE_BY_RECEIPT: Record<ReceiptData["status"], CardPhase> = { confirmed: "result", reverted: "error", pending: "live" };

/** The card flow's next steps after a move (plan §1 step 5): bridge the rest, earn on it, check balance. */
function nextSteps(receipt: ReceiptData): Suggestion[] {
  if (receipt.status !== "confirmed" || receipt.kind === "run" || receipt.kind === "batch") return [];
  const symbol = receipt.received?.token.symbol ?? receipt.sent?.token.symbol ?? "it";
  return [
    chip("Check balance", "What's in my PayBox wallet now?"),
    chip("Earn on it", `Where can my ${symbol} earn the most?`),
    chip("Show activity", "Show my recent Hako activity"),
  ];
}

export const hakoReceipt = defineTool({
  name: "hako_receipt",
  title: "Record a receipt",
  description:
    "Checks a transaction on chain and records it as the person's receipt (what was sent and received, the fee, the " +
    "explorer links). Use it to close a send or move that PayBox completed in another connector: pass the chain and " +
    "the tx hash it returned, and the draft id and version when there was a draft.",
  input: z.object({
    chain: chainInputSchema,
    txHash: txHashSchema,
    draftId: z.string().min(1).optional(),
    version: z.number().int().min(1).optional(),
  }),
  output: structuredContentSchema("receipt"),
  annotations: { ...READ, readOnlyHint: false, idempotentHint: true },
  visibility: MODEL_AND_APP,
  auth: "required",
  cardKinds: ["receipt"],
  async execute({ chain, txHash, draftId, version }, deps) {
    requireUser(deps, "hako_receipt");
    const draft = draftId && version ? { draftId, version } : undefined;
    const receipt = await deps.gateway.call("receiptCreate", { body: { chain, txHash, ...(draft ? { draft } : {}) } });
    return card("receipt", receipt, { phase: PHASE_BY_RECEIPT[receipt.status], suggestions: nextSteps(receipt) }, deps);
  },
});

export { nextSteps as receiptNextSteps, PHASE_BY_RECEIPT };
