import {
  DRAFT_CARD_KINDS,
  draftEditSchema,
  draftRefSchema,
  OUTCOME_CARD_KINDS,
  type StructuredContent,
  structuredContentSchema,
  structuredContentUnion,
} from "@hako/cards/contract";
import type { DraftView } from "@hako/paybox";
import { z } from "zod";

import { APP_ONLY, card, defineTool, DRAFT, READ } from "../define.ts";
import type { AgentDeps } from "../deps.ts";
import { draftCard, type DraftLive, loadDraft, loadDraftVersion } from "../draft-cards.ts";
import { nextInput } from "../draft-edits.ts";
import { AgentToolError, invalidInput } from "../errors.ts";
import { outcomeCard, receiptCard, runOfStatus } from "../outcomes.ts";
import { payCard } from "./catalog.ts";

/**
 * App-only tools (`_meta.ui.visibility: ["app"]`, plan E30): what card buttons and edits call. The model never sees
 * them. Each one reads the draft from the caller's own drafts, so a card is always drawn from Hako's state, never from
 * the client, and an edit names the version its card shows (a stale card is refused with the latest one).
 */

export const hakoDraftUpdate = defineTool({
  name: "hako_draft_update",
  title: "Edit a draft",
  description:
    "App-only: an edit from a draft card makes the next draft version, re-quoted and re-rehearsed in the same card. " +
    "`version` is the version the card shows; a card behind the store is refused with the latest card.",
  input: draftRefSchema.extend({ edit: draftEditSchema }),
  output: structuredContentUnion(DRAFT_CARD_KINDS),
  annotations: DRAFT,
  visibility: APP_ONLY,
  auth: "optional",
  cardKinds: DRAFT_CARD_KINDS,
  async execute({ draftId, version, edit }, deps) {
    const tool = "hako_draft_update";
    const current = await loadDraftVersion(deps, { draftId, version }, tool);
    const next = await nextInput(deps, current, edit);
    await deps.intents.reviseDraft(draftId, next.input);
    return draftCard(await loadDraft(deps, draftId, tool), deps, { known: next.known });
  },
});

export const hakoRoutes = defineTool({
  name: "hako_routes",
  title: "Race the routes",
  description:
    "App-only: races LI.FI's routes for a swap or bridge draft version (one quote per contender bridge, in parallel) " +
    "and streams each snapshot as the answers land. Picking a row calls hako_draft_update with its tool.",
  input: draftRefSchema,
  output: structuredContentSchema("route_race"),
  annotations: READ,
  visibility: APP_ONLY,
  auth: "optional",
  cardKinds: ["route_race"],
  async *execute(ref, deps) {
    const view = await loadDraftVersion(deps, ref, "hako_routes");
    if (view.kind !== "swap" && view.kind !== "bridge") throw new AgentToolError("unsupported", "Only swaps and bridges race routes.");
    const input = (view as DraftView<"swap" | "bridge">).input;
    const body = {
      fromChain: input.fromChain,
      toChain: input.toChain,
      fromToken: input.fromToken,
      toToken: input.toToken,
      fromAmountAtomic: input.fromAmountAtomic,
      fromAddress: input.fromAddress,
      toAddress: input.toAddress,
    };
    const intent = { id: view.id, version: view.version, state: view.state };
    for await (const snapshot of deps.gateway.stream("routes", { body })) {
      yield card("route_race", snapshot, { phase: snapshot.done ? "result" : "streaming", intent }, deps);
    }
  },
});

/** A refreshed card is a pay card, a move draft, or whatever its run turned into (status, result, receipt, failure). */
const REFRESH_KINDS = ["pay", ...DRAFT_CARD_KINDS, ...OUTCOME_CARD_KINDS] as const;
type RefreshCard = StructuredContent<(typeof REFRESH_KINDS)[number]>;

/** A stored draft re-drawn with its live state (a re-mounted card re-reads, never re-sends). */
async function refreshDraft(deps: AgentDeps, draftId: string): Promise<RefreshCard> {
  const view = await loadDraft(deps, draftId, "hako_refresh");
  const live: DraftLive = {};
  if (deps.user) {
    const status = await deps.intents.readStatus(draftId);
    // A draft that ran shows what it turned into, never the draft (plan §1 step 4: a reopened conversation re-reads).
    if (status.requestId) return outcomeCard(deps, view, runOfStatus(view, status));
    live.phase = status.phase;
  }
  if (view.kind === "run") {
    const run = view as DraftView<"run">;
    const doc = await deps.gateway.call("inspect", { body: { id: run.input.toolId } });
    return payCard(deps, doc, run, live);
  }
  if (view.kind === "invoice_pay") {
    const invoice = await deps.gateway.call("invoiceGet", { params: { id: (view as DraftView<"invoice_pay">).input.invoiceId } });
    return card("invoice", invoice, { phase: invoice.status === "paid" ? "result" : "live" }, deps);
  }
  return draftCard(view, deps, live);
}

/** Which id each refresh target reads. */
const REFRESH_ID = { draft: "draftId", invoice: "invoiceId", receipt: "receiptId" } as const;
const REFRESH_TARGETS = ["draft", "invoice", "receipt"] as const satisfies readonly (keyof typeof REFRESH_ID)[];

const refreshInput = z
  .object({
    target: z.enum(REFRESH_TARGETS).describe("What the card shows: a draft (pay card or move), an invoice, or a receipt"),
    draftId: z.string().min(1).optional().describe("target draft: the draft id"),
    invoiceId: z.string().min(1).optional().describe("target invoice: the invoice id"),
    receiptId: z.string().min(1).optional().describe("target receipt: the receipt id"),
  })
  .superRefine((input, ctx) => {
    const field = REFRESH_ID[input.target];
    if (input[field] === undefined) ctx.addIssue({ code: "custom", path: [field], message: `target ${input.target} needs ${field}` });
  });

export const hakoRefresh = defineTool({
  name: "hako_refresh",
  title: "Refresh a card",
  description: "App-only: a card that mounts (or re-mounts in a reopened conversation) re-reads its real state here.",
  input: refreshInput,
  output: structuredContentUnion(REFRESH_KINDS),
  annotations: READ,
  visibility: APP_ONLY,
  auth: "optional",
  cardKinds: REFRESH_KINDS,
  async execute(input, deps) {
    const field = REFRESH_ID[input.target];
    const id = input[field];
    if (id === undefined) throw invalidInput(`target ${input.target} needs ${field}`);
    if (input.target === "draft") return refreshDraft(deps, id);
    if (input.target === "invoice") {
      const invoice = await deps.gateway.call("invoiceGet", { params: { id } });
      return card("invoice", invoice, { phase: invoice.status === "paid" ? "result" : "live" }, deps);
    }
    return receiptCard(deps, await deps.gateway.call("receiptGet", { params: { id } }));
  },
});
