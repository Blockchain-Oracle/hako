/**
 * Free reads through the gateway (plan §1 A9–A10): prediction-market odds with the news around them, and chain
 * lookups on Base, Ethereum, Arbitrum, OP Mainnet, Polygon and Solana. Trading hands off to PayBox's World plugin.
 */
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import { guarded, HakoError } from "../errors.js";
import { callAlias, callGateway } from "../gateway.js";
import { canonicalCaip2 } from "../shared.js";
import { caip2Schema } from "../wire/primitives.js";
import {
  chainBalanceRequestSchema,
  chainBlockRequestSchema,
  chainCallRequestSchema,
  chainGasRequestSchema,
  chainLogsRequestSchema,
  chainNameRequestSchema,
  chainTokenRequestSchema,
  chainTxRequestSchema,
  marketsRequestSchema,
  runEnvelopeSchema,
} from "../wire/reads.js";
import { READ_ONLY } from "./annotations.js";
import { envelopeResult, isRecord, rows } from "./envelope.js";

const PERCENT = 100;
const pct = (value: unknown) => (typeof value === "number" ? `${Math.round(value * PERCENT)}%` : "?");

/** Each read, the alias it calls and the wire body it sends (validated against the mirrored request schema). */
const CHAIN_READS = {
  balance: { endpoint: "chainBalance", schema: chainBalanceRequestSchema },
  token: { endpoint: "chainToken", schema: chainTokenRequestSchema },
  tx: { endpoint: "chainTx", schema: chainTxRequestSchema },
  block: { endpoint: "chainBlock", schema: chainBlockRequestSchema },
  gas: { endpoint: "chainGas", schema: chainGasRequestSchema },
  call: { endpoint: "chainCall", schema: chainCallRequestSchema },
  logs: { endpoint: "chainLogs", schema: chainLogsRequestSchema },
  name: { endpoint: "chainName", schema: chainNameRequestSchema },
} as const;
type ChainRead = keyof typeof CHAIN_READS;
const CHAIN_READ_KEYS = Object.keys(CHAIN_READS) as [ChainRead, ...ChainRead[]];

const blockTag = z.union([z.number().int().min(0), z.literal("latest")]);

export function registerReadTools(server: McpServer) {
  server.registerTool(
    "hako_markets",
    {
      title: "Prediction-market odds",
      description:
        "Free. Prediction-market odds for a question from Polymarket and Jupiter (provider named on each market), " +
        "with the news around it. To trade, use PayBox's official World plugin: world_search, then world_buy_outcome.",
      inputSchema: z
        .object({
          query: marketsRequestSchema.shape.query.describe('The question, e.g. "Will BTC hit 150k this month?".'),
          limit: marketsRequestSchema.shape.limit.unwrap().optional(),
          provider: marketsRequestSchema.shape.provider.describe('Only one source: "polymarket" or "jupiter".'),
        })
        .strict(),
      outputSchema: runEnvelopeSchema,
      annotations: READ_ONLY,
    },
    guarded(async (input) => {
      const envelope = await callGateway("markets", { body: input });
      return envelopeResult(envelope, (data) =>
        rows(data, "markets", (m) => {
          const outcomes = Array.isArray(m.outcomes) ? m.outcomes.filter(isRecord).map((o) => `${String(o.name)} ${pct(o.probability)}`).join(", ") : "";
          return `${String(m.title)} [${String(m.provider)}, ${String(m.status)}]: ${outcomes}${m.url ? ` ${String(m.url)}` : ""}`;
        }),
      );
    }),
  );

  server.registerTool(
    "hako_chain_read",
    {
      title: "Read a chain",
      description:
        "Free chain lookups through Hako's gateway. read: balance (address [+tokens]), token (token by address or " +
        "symbol), tx (hash: receipt or Solana signature status), block (EVM, block or latest), gas, call (EVM view " +
        'call: address, function like "balanceOf(address) view returns (uint256)", args), logs (EVM: from_block, ' +
        "to_block, address, event signature, topics), name (ENS on Ethereum / Basename on Base: name or address). " +
        "Chains: eip155:8453 Base, eip155:1, eip155:42161, eip155:10, eip155:137, solana:mainnet.",
      inputSchema: z
        .object({
          read: z.enum(CHAIN_READ_KEYS),
          chain: caip2Schema,
          address: z.string().min(1).optional(),
          tokens: z.array(z.string().min(1)).optional().describe("balance: extra tokens; the native coin and USDC are always read."),
          token: z.string().min(1).optional(),
          hash: z.string().min(1).optional(),
          block: blockTag.optional(),
          function: z.string().min(1).optional(),
          args: chainCallRequestSchema.shape.args.unwrap().optional(),
          event: z.string().min(1).optional(),
          topics: z.array(z.string().nullable()).optional(),
          from_block: blockTag.optional(),
          to_block: blockTag.optional(),
          name: z.string().min(1).optional(),
        })
        .strict(),
      outputSchema: runEnvelopeSchema,
      annotations: READ_ONLY,
    },
    guarded(async ({ read, ...fields }) => {
      const { endpoint, schema } = CHAIN_READS[read];
      const body = schema.safeParse({ ...fields, chain: canonicalCaip2(fields.chain) ?? fields.chain });
      if (!body.success) {
        const issue = body.error.issues[0];
        throw new HakoError("invalid_input", `read "${read}" needs ${issue ? `${issue.path.join(".") || "its fields"}: ${issue.message}` : "different fields"}.`);
      }
      const envelope = await callAlias(endpoint, body.data);
      return envelopeResult(envelope);
    }),
  );
}
