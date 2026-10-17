import {
  chainBalanceRequestSchema,
  chainBlockRequestSchema,
  chainCallRequestSchema,
  chainGasRequestSchema,
  chainLogsRequestSchema,
  chainTokenRequestSchema,
  chainTxRequestSchema,
  marketsRequestSchema,
  structuredContentSchema,
  structuredContentUnion,
} from "@hako/cards/contract";
import { z } from "zod";

import { card, defineTool, MODEL_AND_APP, READ } from "../define.ts";
import { chainInputSchema } from "../inputs.ts";
import { dataOf, sourceOf } from "../resolve.ts";

/** Free reads through the gateway's aliases (plan B13 "Reads"): markets and chain lookups, no wallet needed. */

export const hakoMarkets = defineTool({
  name: "hako_markets",
  title: "Prediction-market odds",
  description:
    "Free. Odds for a question from prediction markets (Polymarket, Jupiter Prediction; each market labelled with its " +
    "source) and the news around it. Hako shows odds only: trading runs through PayBox's World plugin from the card's " +
    "'Trade on World' button, never from this tool.",
  input: marketsRequestSchema,
  output: structuredContentSchema("market"),
  annotations: READ,
  visibility: MODEL_AND_APP,
  auth: "optional",
  cardKinds: ["market"],
  async execute(input, deps) {
    const envelope = await deps.gateway.call("markets", { body: input });
    const data = dataOf(envelope, `market for "${input.query}"`);
    return card("market", data, { phase: "result", source: sourceOf(envelope) }, deps);
  },
});

const op = <T extends string>(name: T) => z.literal(name);

/** Each lookup: the alias request with the chain taken as people say it. */
const chainReadInput = z.discriminatedUnion("op", [
  chainBalanceRequestSchema.extend({ op: op("balance"), chain: chainInputSchema }),
  chainTokenRequestSchema.extend({ op: op("token"), chain: chainInputSchema }),
  chainTxRequestSchema.extend({ op: op("tx"), chain: chainInputSchema }),
  chainBlockRequestSchema.extend({ op: op("block"), chain: chainInputSchema }),
  chainGasRequestSchema.extend({ op: op("gas"), chain: chainInputSchema }),
  chainCallRequestSchema.extend({ op: op("call"), chain: chainInputSchema }),
  chainLogsRequestSchema.extend({ op: op("logs"), chain: chainInputSchema }),
  z
    .object({
      op: op("name"),
      chain: chainInputSchema,
      name: z.string().min(1).optional().describe("An ENS name or Basename to resolve"),
      address: z.string().min(1).optional().describe("An address to look up the name of"),
    })
    .refine((input) => (input.name === undefined) !== (input.address === undefined), "give exactly one of name or address"),
]);

export const hakoChainRead = defineTool({
  name: "hako_chain_read",
  title: "Read a chain",
  description:
    "Free chain lookups on Base, Ethereum, Arbitrum, Optimism, Polygon (public RPCs) and Solana: balance (native coin, " +
    "USDC and named tokens), token info, a transaction's receipt or status, a block, gas right now, a contract view call, " +
    "event logs, and ENS / Basename lookups. Set `op` to pick the lookup.",
  input: chainReadInput,
  output: structuredContentUnion(["balance", "token", "tx_receipt", "block", "gas", "contract_read", "logs", "chain_name"]),
  annotations: READ,
  visibility: MODEL_AND_APP,
  auth: "optional",
  cardKinds: ["balance", "token", "tx_receipt", "block", "gas", "contract_read", "logs", "chain_name"],
  async execute(input, deps) {
    // Each alias body schema strips `op` before the request leaves (zod objects drop unknown keys).
    const result = { phase: "result" as const };
    switch (input.op) {
      case "balance": {
        const envelope = await deps.gateway.call("chainBalance", { body: input });
        return card("balance", dataOf(envelope, `balance of ${input.address}`), { ...result, source: sourceOf(envelope) }, deps);
      }
      case "token": {
        const envelope = await deps.gateway.call("chainToken", { body: input });
        return card("token", dataOf(envelope, `token ${input.token}`), { ...result, source: sourceOf(envelope) }, deps);
      }
      case "tx": {
        const envelope = await deps.gateway.call("chainTx", { body: input });
        return card("tx_receipt", dataOf(envelope, `transaction ${input.hash}`), { ...result, source: sourceOf(envelope) }, deps);
      }
      case "block": {
        const envelope = await deps.gateway.call("chainBlock", { body: input });
        return card("block", dataOf(envelope, "block"), { ...result, source: sourceOf(envelope) }, deps);
      }
      case "gas": {
        const envelope = await deps.gateway.call("chainGas", { body: input });
        return card("gas", dataOf(envelope, "gas price"), { ...result, source: sourceOf(envelope) }, deps);
      }
      case "call": {
        const envelope = await deps.gateway.call("chainCall", { body: input });
        return card("contract_read", dataOf(envelope, `result of ${input.function}`), { ...result, source: sourceOf(envelope) }, deps);
      }
      case "logs": {
        const envelope = await deps.gateway.call("chainLogs", { body: input });
        return card("logs", dataOf(envelope, "logs"), { ...result, source: sourceOf(envelope) }, deps);
      }
      case "name": {
        const body = input.name !== undefined ? { chain: input.chain, name: input.name } : { chain: input.chain, address: input.address ?? "" };
        const envelope = await deps.gateway.call("chainName", { body });
        return card("chain_name", dataOf(envelope, `name for ${input.name ?? input.address}`), { ...result, source: sourceOf(envelope) }, deps);
      }
    }
  },
});
