import { evmAddressSchema, structuredContentSchema } from "@hako/cards/contract";
import { INVOICE_NOTE_MAX_CHARS } from "@hako/config";
import { BASE, type Caip2, SOLANA } from "@hako/networks";
import { z } from "zod";

import { card, defineTool, DRAFT, MODEL_AND_APP } from "../define.ts";
import type { AgentDeps } from "../deps.ts";
import { draftCard } from "../draft-cards.ts";
import { AgentToolError } from "../errors.ts";
import { amountInputSchema, chainInputSchema, recipientInputSchema, senderInputSchema, tokenInputSchema } from "../inputs.ts";
import { atomicAmount, familyOf, requireAccount, resolveRecipient, resolveToken, senderFor, walletFor, walletRef } from "../resolve.ts";

/**
 * The money drafts (plan E30, §1 card flow step 2): the agent only drafts. Each tool resolves what the person said,
 * creates a draft through the money core (quoted and rehearsed there) and returns its card. Nothing is signed or paid:
 * the card's one button calls `hako_execute` with the version it shows, and every edit makes a new version. A draft
 * whose source chain is off R17's executable list comes back read-only with its reason (`draftCard`'s `blocked`).
 */

const toolInput = z.string().min(1).optional().describe("A LI.FI tool picked from the route race (bridge or exchange key); best route when absent");

/** R17 in the model's words, on every move draft. */
const EXECUTABLE_NOTE = ` Money moves from ${BASE.name} or ${SOLANA.name}; a draft from another chain is shown read-only with a switch to ${BASE.name}.`;

export const hakoDraftSend = defineTool({
  name: "hako_draft_send",
  title: "Draft a send",
  description:
    "Drafts sending a token to someone: a saved contact's name, a PayBox username or an address. Shows a send card " +
    "with the amount, recipient, fee and a rehearsal line; the person sends it with PayBox from the card. Never sends." +
    EXECUTABLE_NOTE,
  input: z.object({
    chain: chainInputSchema,
    token: tokenInputSchema,
    amount: amountInputSchema,
    to: recipientInputSchema,
    from: senderInputSchema,
  }),
  output: structuredContentSchema("send_draft"),
  annotations: DRAFT,
  visibility: MODEL_AND_APP,
  auth: "optional",
  cardKinds: ["send_draft"],
  async execute(input, deps) {
    const [token, to, from] = await Promise.all([
      resolveToken(deps, input.chain, input.token),
      resolveRecipient(deps, input.to, input.chain),
      senderFor(deps, input.chain, input.from, "hako_draft_send"),
    ]);
    const view = await deps.intents.createDraft("send", {
      chain: input.chain,
      token: token.address,
      amountAtomic: atomicAmount(input.amount, token),
      from: from.address,
      to: to.address,
      ...(to.label ? { toLabel: to.label } : {}),
    });
    const drawn = await draftCard(view, deps, { known: [token] });
    return drawn as Extract<typeof drawn, { kind: "send_draft" }>;
  },
});

async function routeDraft(
  deps: AgentDeps,
  kind: "swap" | "bridge",
  input: { fromChain: Caip2; toChain: Caip2; fromToken: string; toToken: string; amount: string; from?: string; to?: string; tool?: string },
) {
  const tool = `hako_draft_${kind}`;
  const [fromToken, toToken, sender] = await Promise.all([
    resolveToken(deps, input.fromChain, input.fromToken),
    resolveToken(deps, input.toChain, input.toToken),
    senderFor(deps, input.fromChain, input.from, tool),
  ]);
  // The recipient: whoever the person named (address, contact or PayBox username), else their own wallet there.
  const recipient = input.to
    ? await resolveRecipient(deps, input.to, input.toChain)
    : familyOf(input.toChain) === sender.family
      ? sender
      : await senderFor(deps, input.toChain, undefined, tool);
  const view = await deps.intents.createDraft(kind, {
    fromChain: input.fromChain,
    toChain: input.toChain,
    fromToken: fromToken.address,
    toToken: toToken.address,
    fromAmountAtomic: atomicAmount(input.amount, fromToken),
    fromAddress: sender.address,
    toAddress: recipient.address,
    ...(input.tool ? { tool: input.tool } : {}),
  });
  return draftCard(view, deps, { known: [fromToken, toToken] });
}

export const hakoDraftSwap = defineTool({
  name: "hako_draft_swap",
  title: "Draft a swap",
  description:
    "Drafts a same-chain swap through LI.FI (e.g. USDC → ETH on Base): shows the amount in, the amount out, the minimum " +
    "received, the route, fee, time and a rehearsal line. The person swaps with PayBox from the card. Never swaps." +
    EXECUTABLE_NOTE,
  input: z.object({
    chain: chainInputSchema,
    fromToken: tokenInputSchema,
    toToken: tokenInputSchema,
    amount: amountInputSchema.describe("Amount of fromToken, in token units"),
    from: senderInputSchema,
    tool: toolInput,
  }),
  output: structuredContentSchema("swap_draft"),
  annotations: DRAFT,
  visibility: MODEL_AND_APP,
  auth: "optional",
  cardKinds: ["swap_draft"],
  async execute(input, deps) {
    const drawn = await routeDraft(deps, "swap", { ...input, fromChain: input.chain, toChain: input.chain });
    return drawn as Extract<typeof drawn, { kind: "swap_draft" }>;
  },
});

export const hakoDraftBridge = defineTool({
  name: "hako_draft_bridge",
  title: "Draft a bridge",
  description:
    "Drafts moving a token between chains through LI.FI (e.g. 1 USDC Base → Solana): shows both amounts, the minimum " +
    "received, the bridge, fee, time and a rehearsal line, and races LI.FI's routes so the person can pick one. The " +
    "person bridges with PayBox from the card. Never bridges." +
    EXECUTABLE_NOTE,
  input: z.object({
    fromChain: chainInputSchema,
    toChain: chainInputSchema,
    fromToken: tokenInputSchema,
    toToken: tokenInputSchema,
    amount: amountInputSchema.describe("Amount of fromToken, in token units"),
    from: senderInputSchema,
    to: recipientInputSchema.optional().describe("Recipient on the destination chain (contact, PayBox username or address); your PayBox wallet when absent"),
    tool: toolInput,
  }),
  output: structuredContentSchema("bridge_draft"),
  annotations: DRAFT,
  visibility: MODEL_AND_APP,
  auth: "optional",
  cardKinds: ["bridge_draft"],
  async execute(input, deps) {
    const drawn = await routeDraft(deps, "bridge", input);
    return drawn as Extract<typeof drawn, { kind: "bridge_draft" }>;
  },
});

const earnInput = z.object({
  chain: chainInputSchema,
  vault: evmAddressSchema.describe("The vault address from the yield card (LI.FI Earn)"),
  token: tokenInputSchema.describe("The token deposited or withdrawn, e.g. USDC"),
  amount: amountInputSchema,
  from: senderInputSchema,
});

async function earnDraft(deps: AgentDeps, kind: "earn_deposit" | "earn_withdraw", input: z.output<typeof earnInput>) {
  if (familyOf(input.chain) !== "evm") throw new AgentToolError("unsupported", "LI.FI Earn runs on EVM chains only.");
  const [token, sender] = await Promise.all([resolveToken(deps, input.chain, input.token), senderFor(deps, input.chain, input.from, `hako_draft_${kind}`)]);
  const view = await deps.intents.createDraft(kind, {
    chain: input.chain,
    vault: input.vault,
    token: token.address,
    amountAtomic: atomicAmount(input.amount, token),
    fromAddress: sender.address,
  });
  return draftCard(view, deps, { known: [token] });
}

export const hakoDraftEarnDeposit = defineTool({
  name: "hako_draft_earn_deposit",
  title: "Draft an Earn deposit",
  description:
    "Drafts depositing into a LI.FI Earn vault (from the yield card): amount, vault, expected shares, fee and a " +
    "rehearsal line; an exact approve comes first when needed ('Step 1 of 2'). The person deposits from the card." +
    EXECUTABLE_NOTE,
  input: earnInput,
  output: structuredContentSchema("earn_deposit_draft"),
  annotations: DRAFT,
  visibility: MODEL_AND_APP,
  auth: "optional",
  cardKinds: ["earn_deposit_draft"],
  async execute(input, deps) {
    const drawn = await earnDraft(deps, "earn_deposit", input);
    return drawn as Extract<typeof drawn, { kind: "earn_deposit_draft" }>;
  },
});

export const hakoDraftEarnWithdraw = defineTool({
  name: "hako_draft_earn_withdraw",
  title: "Draft an Earn withdraw",
  description:
    "Drafts withdrawing from a LI.FI Earn position: amount, vault, what comes back, fee and a rehearsal line. The " +
    "person withdraws from the card. Never withdraws." +
    EXECUTABLE_NOTE,
  input: earnInput,
  output: structuredContentSchema("earn_withdraw_draft"),
  annotations: DRAFT,
  visibility: MODEL_AND_APP,
  auth: "optional",
  cardKinds: ["earn_withdraw_draft"],
  async execute(input, deps) {
    const drawn = await earnDraft(deps, "earn_withdraw", input);
    return drawn as Extract<typeof drawn, { kind: "earn_withdraw_draft" }>;
  },
});

export const hakoDraftInvoice = defineTool({
  name: "hako_draft_invoice",
  title: "Invoice someone",
  description:
    "Creates a pay-me invoice in USDC on Base, paid straight to the person's PayBox wallet: the card shows the amount, " +
    "the note, a QR of the pay link and an agent-payable link, and flips to Paid when it is paid. Nothing moves until " +
    "the payer pays it.",
  input: z.object({
    amount: amountInputSchema.describe("USDC amount, e.g. 25"),
    note: z.string().max(INVOICE_NOTE_MAX_CHARS).optional().describe("What it is for, shown to the payer"),
    payTo: evmAddressSchema.optional().describe("The wallet paid; the connected PayBox EVM wallet when absent"),
  }),
  output: structuredContentSchema("invoice"),
  annotations: DRAFT,
  visibility: MODEL_AND_APP,
  auth: "optional",
  cardKinds: ["invoice"],
  async execute(input, deps) {
    const usdc = { chain: BASE.caip2, address: BASE.usdc.address, symbol: BASE.usdc.symbol, decimals: BASE.usdc.decimals };
    const payTo = input.payTo ?? walletRef(await walletFor(requireAccount(deps, "hako_draft_invoice"), "evm")).address;
    const invoice = await deps.gateway.call("invoiceCreate", {
      body: { amountAtomic: atomicAmount(input.amount, usdc), payTo, ...(input.note ? { note: input.note } : {}) },
    });
    // An open invoice waits for its payer: the card follows it (hako_refresh) and flips to Paid.
    return card("invoice", invoice, { phase: invoice.status === "paid" ? "result" : "live" }, deps);
  },
});
