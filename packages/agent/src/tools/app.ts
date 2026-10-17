import {
  DRAFT_CARD_KINDS,
  draftEditSchema,
  type StructuredContent,
  structuredContentSchema,
  structuredContentUnion,
} from "@hako/cards/contract";
import type { DraftView } from "@hako/paybox";
import { z } from "zod";

import { APP_ONLY, card, defineTool, DRAFT, READ } from "../define.ts";
import type { AgentDeps } from "../deps.ts";
import { draftCard, type DraftLive, loadDraft } from "../draft-cards.ts";
import { nextInput } from "../draft-edits.ts";
import { AgentToolError } from "../errors.ts";
import { requestRef } from "../status-cards.ts";
import { payCard } from "./catalog.ts";
import { PHASE_BY_RECEIPT, receiptNextSteps } from "./execute.ts";

/**
 * App-only tools (`_meta.ui.visibility: ["app"]`, plan E30): what card buttons and edits call. The model never sees
 * them. Each one reads the draft from the store, so a card is always drawn from Hako's state, never from the client.
 */

export const hakoDraftUpdate = defineTool({
  name: "hako_draft_update",
  title: "Edit a draft",
  description: "App-only: an edit from a draft card makes the next draft version, re-quoted and re-rehearsed in the same card.",
  input: z.object({ draftId: z.string().min(1), edit: draftEditSchema }),
  output: structuredContentUnion(DRAFT_CARD_KINDS),
  annotations: DRAFT,
  visibility: APP_ONLY,
  auth: "optional",
  cardKinds: DRAFT_CARD_KINDS,
  async execute({ draftId, edit }, deps) {
    const current = await loadDraft(deps, draftId);
    const next = await nextInput(deps, current, edit);
    await deps.intents.reviseDraft(draftId, next.input);
    return draftCard(await loadDraft(deps, draftId), deps, { known: next.known });
  },
});

export const hakoRoutes = defineTool({
  name: "hako_routes",
  title: "Race the routes",
  description:
    "App-only: races LI.FI's routes for a swap or bridge draft (one quote per contender bridge, in parallel) and streams " +
    "each snapshot as the answers land. Picking a row calls hako_draft_update with its tool.",
  input: z.object({ draftId: z.string().min(1) }),
  output: structuredContentSchema("route_race"),
  annotations: READ,
  visibility: APP_ONLY,
  auth: "optional",
  cardKinds: ["route_race"],
  async *execute({ draftId }, deps) {
    const view = await loadDraft(deps, draftId);
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

const REFRESH_KINDS = [...DRAFT_CARD_KINDS, "pay", "invoice", "receipt"] as const;

/** A stored draft re-drawn with its live status (a re-mounted card re-reads, never re-sends). */
async function refreshDraft(deps: AgentDeps, draftId: string): Promise<StructuredContent<(typeof REFRESH_KINDS)[number]>> {
  const view = await loadDraft(deps, draftId);
  const live: DraftLive = {};
  if (deps.user) {
    const status = await deps.intents.readStatus(draftId);
    live.phase = status.phase;
    if (status.requestId && status.requestStatus) live.request = requestRef(deps, status.requestId, status.requestStatus, status.approvalUrl);
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

export const hakoRefresh = defineTool({
  name: "hako_refresh",
  title: "Refresh a card",
  description: "App-only: a card that mounts (or re-mounts in a reopened conversation) re-reads its real state here.",
  input: z.discriminatedUnion("target", [
    z.object({ target: z.literal("draft"), draftId: z.string().min(1) }),
    z.object({ target: z.literal("invoice"), invoiceId: z.string().min(1) }),
    z.object({ target: z.literal("receipt"), receiptId: z.string().min(1) }),
  ]),
  output: structuredContentUnion(REFRESH_KINDS),
  annotations: READ,
  visibility: APP_ONLY,
  auth: "optional",
  cardKinds: REFRESH_KINDS,
  async execute(input, deps) {
    if (input.target === "draft") return refreshDraft(deps, input.draftId);
    if (input.target === "invoice") {
      const invoice = await deps.gateway.call("invoiceGet", { params: { id: input.invoiceId } });
      return card("invoice", invoice, { phase: invoice.status === "paid" ? "result" : "live" }, deps);
    }
    const receipt = await deps.gateway.call("receiptGet", { params: { id: input.receiptId } });
    return card("receipt", receipt, { phase: PHASE_BY_RECEIPT[receipt.status], suggestions: receiptNextSteps(receipt) }, deps);
  },
});
