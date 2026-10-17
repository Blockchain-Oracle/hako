import {
  chainBalanceRequestSchema,
  chainBlockRequestSchema,
  chainCallRequestSchema,
  chainLogsRequestSchema,
  chainTxRequestSchema,
  earnVaultsRequestSchema,
  marketsRequestSchema,
  READ_ALIAS_CONNECTORS,
  type ReadAliasKey,
  structuredContentSchema,
  structuredContentUnion,
} from "@hako/cards/contract";
import { z } from "zod";

import { card, defineTool, MODEL_AND_APP, READ } from "../define.ts";
import { AgentToolError, invalidInput } from "../errors.ts";
import { chainInputSchema } from "../inputs.ts";
import { dataOf, familyOf, sourceOf } from "../resolve.ts";

/** Free reads through the gateway's aliases (plan B13 "Reads"): markets, chain lookups and LI.FI Earn, no wallet needed. */

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

/** Each lookup and the gateway alias it reads. */
const OP_ENDPOINTS = {
  balance: "chainBalance",
  token: "chainToken",
  tx: "chainTx",
  block: "chainBlock",
  gas: "chainGas",
  call: "chainCall",
  logs: "chainLogs",
  name: "chainName",
  earn_vaults: "earnVaults",
  earn_positions: "earnPositions",
} as const satisfies Record<string, ReadAliasKey>;
type ChainReadOp = keyof typeof OP_ENDPOINTS;
const CHAIN_READ_OPS = Object.keys(OP_ENDPOINTS) as [ChainReadOp, ...ChainReadOp[]];

/**
 * One object for every lookup (model tool schemas need `type: "object"` at the root): `op` picks the lookup, and the
 * fields it needs are checked per op. Field shapes are the alias request schemas' own (snake_case, as connectors take
 * them); the chain is taken as people say it.
 */
const chainReadFields = z.object({
    op: z
      .enum(CHAIN_READ_OPS)
      .describe(
        "balance, token, tx, block, gas, call (contract view call), logs, name (ENS / Basename), earn_vaults (where a " +
          "token earns most on LI.FI Earn), earn_positions (a wallet's Earn positions)",
      ),
    chain: chainInputSchema.optional().describe("The chain; needed by every op except earn_vaults and earn_positions (all chains when absent)"),
    address: z
      .string()
      .min(1)
      .optional()
      .describe("balance and earn_positions: the wallet; call: the contract; logs: the emitting contract; name: an address to look up"),
    tokens: chainBalanceRequestSchema.shape.tokens.describe("balance: extra tokens by symbol or address (native coin and USDC always)"),
    token: z.string().min(1).optional().describe("token: the token by symbol or address; earn_vaults: the underlying token, e.g. USDC"),
    hash: chainTxRequestSchema.shape.hash.optional().describe("tx: a transaction hash or Solana signature"),
    block: chainBlockRequestSchema.shape.block.describe("block and call: a block number or 'latest'"),
    function: chainCallRequestSchema.shape.function.optional().describe("call: e.g. 'balanceOf(address) view returns (uint256)'"),
    args: chainCallRequestSchema.shape.args.describe("call: the function's arguments"),
    event: chainLogsRequestSchema.shape.event.describe("logs: e.g. 'Transfer(address indexed from, address indexed to, uint256 value)'"),
    topics: chainLogsRequestSchema.shape.topics,
    from_block: chainLogsRequestSchema.shape.from_block.optional().describe("logs: the first block"),
    to_block: chainLogsRequestSchema.shape.to_block,
    name: z.string().min(1).optional().describe("name: an ENS name or Basename to resolve"),
    sort: earnVaultsRequestSchema.shape.sort.describe("earn_vaults: rank by apy or tvl"),
    limit: earnVaultsRequestSchema.shape.limit.describe("earn_vaults: how many vaults"),
});
type ChainReadInput = z.output<typeof chainReadFields>;

const chainReadInput = chainReadFields.superRefine((input, ctx) => {
  for (const field of REQUIRED[input.op]) {
    if (input[field] === undefined) ctx.addIssue({ code: "custom", path: [field], message: `op ${input.op} needs ${field}` });
  }
  if (input.op === "name" && (input.name === undefined) === (input.address === undefined)) {
    ctx.addIssue({ code: "custom", path: ["name"], message: "op name needs exactly one of name or address" });
  }
});

/** The fields each lookup needs (checked by the schema, so the model is told before anything runs). */
const REQUIRED: Record<ChainReadOp, readonly (keyof ChainReadInput)[]> = {
  balance: ["chain", "address"],
  token: ["chain", "token"],
  tx: ["chain", "hash"],
  block: ["chain"],
  gas: ["chain"],
  call: ["chain", "address", "function"],
  logs: ["chain", "from_block"],
  name: ["chain"],
  earn_vaults: [],
  earn_positions: ["address"],
};

/** A field the op needs, typed as present (the schema already refused an input without it). */
function need<K extends keyof ChainReadInput>(input: ChainReadInput, field: K): NonNullable<ChainReadInput[K]> {
  const value = input[field];
  if (value === undefined || value === null) throw invalidInput(`op ${input.op} needs ${String(field)}`);
  return value;
}

/** A chain lookup the chain's family has no connector for (READ_ALIAS_CONNECTORS: blocks, calls, logs and names are EVM). */
function checkFamily(op: ChainReadOp, input: ChainReadInput): void {
  if (!input.chain) return;
  const connectors: Readonly<Record<string, string | null>> = READ_ALIAS_CONNECTORS[OP_ENDPOINTS[op]];
  if (connectors[familyOf(input.chain)] === null) throw new AgentToolError("unsupported", `The ${op} lookup runs on EVM chains only.`);
}

export const hakoChainRead = defineTool({
  name: "hako_chain_read",
  title: "Read a chain",
  description:
    "Free chain lookups on Base, Ethereum, Arbitrum, Optimism, Polygon (public RPCs) and Solana: balance (native coin, " +
    "USDC and named tokens), token info, a transaction's receipt or status, a block, gas right now, a contract view call, " +
    "event logs, ENS / Basename lookups, and LI.FI Earn: where a token earns most (earn_vaults, the yield card to " +
    "deposit from) and a wallet's Earn positions. Set `op` to pick the lookup.",
  input: chainReadInput,
  output: structuredContentUnion(["balance", "token", "tx_receipt", "block", "gas", "contract_read", "logs", "chain_name", "yield", "positions"]),
  annotations: READ,
  visibility: MODEL_AND_APP,
  auth: "optional",
  cardKinds: ["balance", "token", "tx_receipt", "block", "gas", "contract_read", "logs", "chain_name", "yield", "positions"],
  async execute(input, deps) {
    checkFamily(input.op, input);
    const result = { phase: "result" as const };
    switch (input.op) {
      case "balance": {
        const body = { chain: need(input, "chain"), address: need(input, "address"), ...(input.tokens ? { tokens: input.tokens } : {}) };
        const envelope = await deps.gateway.call("chainBalance", { body });
        return card("balance", dataOf(envelope, `balance of ${body.address}`), { ...result, source: sourceOf(envelope) }, deps);
      }
      case "token": {
        const body = { chain: need(input, "chain"), token: need(input, "token") };
        const envelope = await deps.gateway.call("chainToken", { body });
        return card("token", dataOf(envelope, `token ${body.token}`), { ...result, source: sourceOf(envelope) }, deps);
      }
      case "tx": {
        const body = { chain: need(input, "chain"), hash: need(input, "hash") };
        const envelope = await deps.gateway.call("chainTx", { body });
        return card("tx_receipt", dataOf(envelope, `transaction ${body.hash}`), { ...result, source: sourceOf(envelope) }, deps);
      }
      case "block": {
        const body = { chain: need(input, "chain"), ...(input.block !== undefined ? { block: input.block } : {}) };
        const envelope = await deps.gateway.call("chainBlock", { body });
        return card("block", dataOf(envelope, "block"), { ...result, source: sourceOf(envelope) }, deps);
      }
      case "gas": {
        const envelope = await deps.gateway.call("chainGas", { body: { chain: need(input, "chain") } });
        return card("gas", dataOf(envelope, "gas price"), { ...result, source: sourceOf(envelope) }, deps);
      }
      case "call": {
        const body = {
          chain: need(input, "chain"),
          address: need(input, "address"),
          function: need(input, "function"),
          args: input.args,
          ...(input.block !== undefined ? { block: input.block } : {}),
        };
        const envelope = await deps.gateway.call("chainCall", { body });
        return card("contract_read", dataOf(envelope, `result of ${body.function}`), { ...result, source: sourceOf(envelope) }, deps);
      }
      case "logs": {
        const { address, event, topics, to_block } = input;
        const body = {
          chain: need(input, "chain"),
          from_block: need(input, "from_block"),
          ...(address ? { address } : {}),
          ...(event ? { event } : {}),
          ...(topics ? { topics } : {}),
          ...(to_block !== undefined ? { to_block } : {}),
        };
        const envelope = await deps.gateway.call("chainLogs", { body });
        return card("logs", dataOf(envelope, "logs"), { ...result, source: sourceOf(envelope) }, deps);
      }
      case "name": {
        const chain = need(input, "chain");
        const body = input.name !== undefined ? { chain, name: input.name } : { chain, address: need(input, "address") };
        const envelope = await deps.gateway.call("chainName", { body });
        return card("chain_name", dataOf(envelope, `name for ${input.name ?? input.address}`), { ...result, source: sourceOf(envelope) }, deps);
      }
      case "earn_vaults": {
        const { chain, token, sort, limit } = input;
        const body = { sort, limit, ...(chain ? { chain } : {}), ...(token ? { token } : {}) };
        const envelope = await deps.gateway.call("earnVaults", { body });
        return card("yield", dataOf(envelope, `Earn vault for ${token ?? "that token"}`), { ...result, source: sourceOf(envelope) }, deps);
      }
      case "earn_positions": {
        const body = { address: need(input, "address"), ...(input.chain ? { chain: input.chain } : {}) };
        const envelope = await deps.gateway.call("earnPositions", { body });
        return card("positions", dataOf(envelope, `Earn positions of ${body.address}`), { ...result, source: sourceOf(envelope) }, deps);
      }
    }
  },
});
