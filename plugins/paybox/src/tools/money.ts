/**
 * LI.FI swaps and bridges (plan §1 A5–A7): a free quote, the move as one PayBox proposal (exact approve first when the
 * allowance is short, then the R15-bound transfer from a fresh quote), and the bridge's status.
 */
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import { guarded } from "../errors.js";
import { callGateway } from "../gateway.js";
import { amountText, executableChain, moveOutputSchema, proposeMove } from "../proposals.js";
import { canonicalCaip2, networkByCaip2, type ReviewedRoute } from "../shared.js";
import { requireWalletFor, resolveToken } from "../tokens.js";
import { bridgeRequestSchema, bridgeStatusQuerySchema, bridgeStatusResponseSchema, quoteRequestSchema, type RouteData, routeDataSchema } from "../wire/money.js";
import { MOVES_MONEY, READ_ONLY } from "./annotations.js";

const routeFields = {
  fromChain: quoteRequestSchema.shape.fromChain.describe("Source chain, CAIP-2: eip155:8453 (Base), solana:mainnet, eip155:1, eip155:42161…"),
  toChain: quoteRequestSchema.shape.toChain.describe("Destination chain, CAIP-2 (the same chain for a swap)."),
  fromToken: quoteRequestSchema.shape.fromToken.describe('Token to spend: its contract or mint, or "USDC" / the native symbol (ETH, SOL).'),
  toToken: quoteRequestSchema.shape.toToken.describe('Token to receive: contract or mint, or "USDC" / the native symbol.'),
  fromAmountAtomic: quoteRequestSchema.shape.fromAmountAtomic.describe("Amount to spend in atomic units (1 USDC = 1000000; 1 ETH = 10^18; 1 SOL = 10^9)."),
  fromAddress: quoteRequestSchema.shape.fromAddress.describe("The PayBox wallet that signs (from list_credentials; pass the same wallet as use_plugin.wallet_id)."),
  toAddress: quoteRequestSchema.shape.toAddress.describe("Who receives on the destination chain (usually the person's own PayBox wallet there)."),
};

const chainName = (caip2: string) => networkByCaip2(caip2)?.name ?? caip2;

/** The quote in words: what goes out, the least that arrives, fees, time and the rehearsal line. */
function routeText(route: RouteData): string {
  const rehearsal = route.rehearsal
    ? route.rehearsal.status === "passed"
      ? "Rehearsed: no revert."
      : route.rehearsal.status === "unsupported"
        ? `Not rehearsed on ${chainName(route.rehearsal.chain)}.`
        : `Rehearsal ${route.rehearsal.status}${route.rehearsal.reason ? `: ${route.rehearsal.reason}` : ""}.`
    : "Not rehearsed.";
  return (
    `${amountText(route.fromAmountAtomic, route.fromToken.decimals, route.fromToken.symbol)} on ${chainName(route.fromChain)} → ` +
    `${amountText(route.toAmountAtomic, route.toToken.decimals, route.toToken.symbol)} on ${chainName(route.toChain)} ` +
    `(at least ${amountText(route.toAmountMinAtomic, route.toToken.decimals, route.toToken.symbol)}) via ${route.toolName}` +
    `${route.feeUsd ? `, fees about $${route.feeUsd}` : ""}${route.estimatedDurationS !== null ? `, about ${route.estimatedDurationS} s` : ""}. ` +
    `${rehearsal} Quote expires ${route.expiresAt}.`
  );
}

export function registerMoneyTools(server: McpServer) {
  server.registerTool(
    "hako_quote",
    {
      title: "Quote a swap or bridge",
      description:
        "Free. A LI.FI quote to swap on one chain or bridge across 66 chains: amount out, minimum received, fees, " +
        "time, the route's tool and a rehearsal line. Nothing is signed. To move, show it to the person, then call " +
        "hako_bridge with the same input plus this quote's tool and toAmountMinAtomic as minReceivedAtomic.",
      inputSchema: z
        .object({ ...routeFields, tool: quoteRequestSchema.shape.tool.describe("Pin one LI.FI bridge or exchange key (optional).") })
        .strict(),
      outputSchema: routeDataSchema,
      annotations: READ_ONLY,
    },
    guarded(async (input) => {
      const fromChain = canonicalCaip2(input.fromChain) ?? input.fromChain;
      const toChain = canonicalCaip2(input.toChain) ?? input.toChain;
      requireWalletFor(fromChain, input.fromAddress, "fromAddress");
      requireWalletFor(toChain, input.toAddress, "toAddress");
      const body = {
        ...input,
        fromChain,
        toChain,
        fromToken: resolveToken(fromChain, input.fromToken),
        toToken: resolveToken(toChain, input.toToken),
      };
      const route = await callGateway("quote", { body });
      const next =
        `To move: hako_bridge with fromChain "${route.fromChain}", toChain "${route.toChain}", fromToken "${route.fromToken.address}", ` +
        `toToken "${route.toToken.address}", fromAmountAtomic "${route.fromAmountAtomic}", fromAddress "${route.fromAddress}", ` +
        `toAddress "${route.toAddress}", tool "${route.tool}", minReceivedAtomic "${route.toAmountMinAtomic}".`;
      return { content: [{ type: "text" as const, text: `${routeText(route)}\n${next}` }], structuredContent: route };
    }),
  );

  server.registerTool(
    "hako_bridge",
    {
      title: "Swap or bridge with PayBox",
      description:
        "Moves tokens through LI.FI as one PayBox proposal (one EVM call, or one Solana transaction with a single " +
        "signer). Input: the reviewed quote's route plus its tool and minimum received. When the allowance is short " +
        'it returns only the exact-amount approve ("Step 1 of 2"): when that request reaches success, call hako_bridge ' +
        "again with the same input. Otherwise it returns the transfer from a fresh quote pinned to the tool, refused " +
        "unless sender, recipient, tokens, amount and tool match and the minimum received is at least the reviewed one; " +
        "a lower minimum comes back for review instead. Signs from Base or Solana.",
      inputSchema: z
        .object({
          ...routeFields,
          tool: bridgeRequestSchema.shape.tool.describe("The LI.FI tool of the reviewed quote (hako_quote's tool)."),
          minReceivedAtomic: bridgeRequestSchema.shape.minReceivedAtomic.describe("The reviewed quote's toAmountMinAtomic: the least the person accepts."),
        })
        .strict(),
      outputSchema: moveOutputSchema,
      annotations: MOVES_MONEY,
    },
    guarded(async (input) => {
      const fromChain = executableChain(input.fromChain);
      const toChain = canonicalCaip2(input.toChain) ?? input.toChain;
      requireWalletFor(fromChain, input.fromAddress, "fromAddress");
      requireWalletFor(toChain, input.toAddress, "toAddress");
      const body = {
        ...input,
        fromChain,
        toChain,
        fromToken: resolveToken(fromChain, input.fromToken),
        toToken: resolveToken(toChain, input.toToken),
      };
      const { minReceivedAtomic, ...route } = body;
      const reviewed: ReviewedRoute = { ...route, toAmountMinAtomic: minReceivedAtomic };
      const response = await callGateway("bridge", { body });
      return proposeMove(reviewed, response, "hako_bridge", fromChain === toChain ? "Swap" : "Bridge");
    }),
  );

  server.registerTool(
    "hako_bridge_status",
    {
      title: "Bridge status",
      description:
        "Free. LI.FI's status for a bridge's source transaction: pending, done, failed or not found, with both " +
        "transaction hashes and explorer links when known. Use the source tx hash from the PayBox request's result.",
      inputSchema: z
        .object({
          txHash: bridgeStatusQuerySchema.shape.txHash.describe("The source chain transaction hash or Solana signature."),
          fromChain: bridgeStatusQuerySchema.shape.fromChain,
          toChain: bridgeStatusQuerySchema.shape.toChain,
          tool: bridgeStatusQuerySchema.shape.tool,
        })
        .strict(),
      outputSchema: bridgeStatusResponseSchema,
      annotations: READ_ONLY,
    },
    guarded(async (query) => {
      const status = await callGateway("bridgeStatus", { query });
      const leg = (side: typeof status.sending | null, label: string) =>
        side?.txHash ? `${label} ${side.txHash} on ${chainName(side.chain)}${side.explorerUrl ? ` (${side.explorerUrl})` : ""}` : `${label}: not yet`;
      const text =
        `Bridge ${status.status}${status.substatus ? ` (${status.substatus}${status.substatusMessage ? `: ${status.substatusMessage}` : ""})` : ""}. ` +
        `${leg(status.sending, "Sent")}. ${leg(status.receiving, "Received")}.`;
      return { content: [{ type: "text" as const, text }], structuredContent: status };
    }),
  );
}
