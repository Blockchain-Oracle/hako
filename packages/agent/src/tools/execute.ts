import { draftRefSchema, OUTCOME_CARD_KINDS, SIGNED_TX_MAX_CHARS, structuredContentSchema, structuredContentUnion, txHashSchema } from "@hako/cards/contract";
import { BASE } from "@hako/networks";
import { z } from "zod";

import { APP_ONLY, defineTool, MODEL_AND_APP, MONEY, READ } from "../define.ts";
import { executableBlock, loadDraft, loadDraftVersion } from "../draft-cards.ts";
import { AgentToolError } from "../errors.ts";
import { chainInputSchema } from "../inputs.ts";
import { failureCard, outcomeCard, receiptCard, runOfStatus } from "../outcomes.ts";
import { requireAccount, requireUser, txLink } from "../resolve.ts";
import { statusCard } from "../status-cards.ts";

/**
 * Execution and its outcome (plan §1 execution rules): `hako_execute` creates the one PayBox request for a draft
 * version (a repeat returns the stored one), `hako_request_status` re-reads it, `hako_broadcast` hands a signed tx from
 * the user's own PayBox connector to Hako's broadcast checks, and `hako_receipt` records a transaction checked on chain.
 * The first three answer with the outcome cards: the live status, the paid result with its receipt line, the receipt,
 * or the failure that says whether money moved.
 */

const outcomeOutput = structuredContentUnion(OUTCOME_CARD_KINDS);

export const hakoExecute = defineTool({
  name: "hako_execute",
  title: "Pay or move with PayBox",
  description:
    "Runs one draft version with PayBox: pays a pay card or sends, swaps, bridges, deposits or withdraws exactly what " +
    "that version of the card shows. PayBox asks the person to approve; the card follows the request to its result or " +
    "receipt. Call it only for the draft id and version the person confirmed; calling it again returns the same request.",
  input: draftRefSchema,
  output: outcomeOutput,
  annotations: MONEY,
  visibility: MODEL_AND_APP,
  auth: "required",
  cardKinds: OUTCOME_CARD_KINDS,
  async execute(ref, deps) {
    const tool = "hako_execute";
    const user = requireUser(deps, tool);
    requireAccount(deps, tool);
    const view = await loadDraftVersion(deps, ref, tool);
    const blocked = executableBlock(view);
    if (blocked) throw new AgentToolError("unsupported", `${blocked.reason}: switch the draft to ${BASE.name} first.`, "change_network");
    const result = await deps.intents.executeDraft(ref.draftId, ref.version, user.id);
    const after = await loadDraft(deps, ref.draftId, tool);
    return outcomeCard(deps, after, {
      version: result.version,
      phase: result.phase,
      state: after.version === result.version ? after.state : null,
      requestId: result.requestId,
      requestStatus: result.status,
      approvalUrl: result.approvalUrl,
      txs: [],
      reason: null,
      reused: result.reused,
    });
  },
});

export const hakoRequestStatus = defineTool({
  name: "hako_request_status",
  title: "Follow a payment or move",
  description: "App-only: re-reads a draft's PayBox request and transactions (never re-sends anything).",
  input: z.object({ draftId: z.string().min(1) }),
  output: outcomeOutput,
  annotations: READ,
  visibility: APP_ONLY,
  auth: "required",
  cardKinds: OUTCOME_CARD_KINDS,
  async execute({ draftId }, deps) {
    const tool = "hako_request_status";
    requireAccount(deps, tool);
    const view = await loadDraft(deps, draftId, tool);
    return outcomeCard(deps, view, runOfStatus(view, await deps.intents.readStatus(draftId)));
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
  output: outcomeOutput,
  annotations: MONEY,
  visibility: MODEL_AND_APP,
  auth: "required",
  cardKinds: OUTCOME_CARD_KINDS,
  async execute(input, deps) {
    const tool = "hako_broadcast";
    requireAccount(deps, tool);
    const view = await loadDraft(deps, input.draftId, tool);
    const sent = await deps.gateway.call("broadcast", { body: input });
    const run = {
      version: input.version,
      phase: sent.status === "refused" ? ("error" as const) : ("live" as const),
      state: view.version === input.version ? view.state : null,
      requestId: null,
      requestStatus: null,
      approvalUrl: null,
      txs: sent.txHash ? [txLink(input.chain, sent.txHash, "source")] : [],
      reason: sent.reason,
      reused: sent.status === "already_known",
    };
    if (sent.status === "refused") {
      // A refused tx was never sent: the route says whether money moved (it never does for a refusal).
      return failureCard(deps, view, run, { title: "Signed but not sent", moneyMoved: sent.moneyMoved });
    }
    return statusCard(deps, { ...run, draftId: view.id, kind: view.kind, receiptId: null, stage: "sent" });
  },
});

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
    // A receipt is linked only to a draft the caller may see.
    if (draft) await loadDraft(deps, draft.draftId, "hako_receipt");
    const receipt = await deps.gateway.call("receiptCreate", { body: { chain, txHash, ...(draft ? { draft } : {}) } });
    return receiptCard(deps, receipt);
  },
});
