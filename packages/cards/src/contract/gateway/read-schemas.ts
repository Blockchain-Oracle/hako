import { z } from "zod";

import {
  CONTRACT_ARGS_MAX,
  DISCOVER_LIMIT_DEFAULT,
  DISCOVER_LIMIT_MAX,
  DISCOVER_QUERY_MAX_CHARS,
  MARKET_QUERY_MAX_CHARS,
  MARKETS_LIMIT_DEFAULT,
  MARKETS_LIMIT_MAX,
  TOOL_ID_MAX_CHARS,
  VAULTS_LIMIT_DEFAULT,
  VAULTS_LIMIT_MAX,
} from "../contract.config.ts";
import { caip2Schema, urlSchema } from "../primitives.ts";

/**
 * Request bodies of the free reads: the catalog routes hako-api serves through the gateway, and the read aliases
 * (`/v1/chain/*`, `/v1/markets`, `/v1/earn/{vaults,positions}`) that forward the body unchanged to a free catalog
 * connector (plan B13 "Reads": L2 writes the connectors, L1 the alias table). An alias body IS the connector's input,
 * so these are snake_case like every connector input, and each connector's pydantic input must accept them.
 */

/** `POST /v1/discover` (hako-api DiscoverBody). */
export const discoverRequestSchema = z.object({
  query: z.string().min(1).max(DISCOVER_QUERY_MAX_CHARS),
  category: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(DISCOVER_LIMIT_MAX).default(DISCOVER_LIMIT_DEFAULT),
  include_unavailable: z.boolean().optional(),
});

/** A catalog id: `<provider>/<slug>` (`wikipedia/summary`). */
export const toolIdSchema = z
  .string()
  .min(1)
  .max(TOOL_ID_MAX_CHARS)
  .regex(/^[a-z0-9-]+\/[a-z0-9-]+$/, "a catalog id like wikipedia/summary");

/** `POST /v1/inspect` (hako-api InspectBody). */
export const inspectRequestSchema = z.object({ id: toolIdSchema });

/** `/v1/endpoints/:provider/:slug`, `/v1/validate/:provider/:slug`, `/v2/run/:provider/:slug`. */
export const toolPathParamsSchema = z.object({
  provider: z.string().regex(/^[a-z0-9-]+$/),
  slug: z.string().regex(/^[a-z0-9-]+$/),
});

/** `GET /v1/logo?src=`: an allowlisted logo URL, cached 24 h. */
export const logoQuerySchema = z.object({ src: urlSchema });

/** A block: its number, or the chain head. */
const blockTagSchema = z.union([z.number().int().min(0), z.literal("latest")]);

/** `POST /v1/chain/balance`: native coin, USDC and any token asked for (SPL tokens on Solana). */
export const chainBalanceRequestSchema = z.object({
  chain: caip2Schema,
  address: z.string().min(1),
  /** Extra tokens by address or symbol; the native coin and USDC are always read. */
  tokens: z.array(z.string().min(1)).optional(),
});

/** `POST /v1/chain/token`: one token by address or symbol (what drafts resolve "USDC" with). */
export const chainTokenRequestSchema = z.object({ chain: caip2Schema, token: z.string().min(1) });

/** `POST /v1/chain/tx`: a transaction's receipt or a Solana signature's status. */
export const chainTxRequestSchema = z.object({ chain: caip2Schema, hash: z.string().min(1) });

/** `POST /v1/chain/block` (EVM). */
export const chainBlockRequestSchema = z.object({ chain: caip2Schema, block: blockTagSchema.optional() });

/** `POST /v1/chain/gas`. */
export const chainGasRequestSchema = z.object({ chain: caip2Schema });

/** `POST /v1/chain/call` (EVM view call): the function by its human-readable signature. */
export const chainCallRequestSchema = z.object({
  chain: caip2Schema,
  address: z.string().min(1),
  /** e.g. "balanceOf(address) view returns (uint256)". */
  function: z.string().min(1),
  args: z.array(z.unknown()).max(CONTRACT_ARGS_MAX).default([]),
  block: blockTagSchema.optional(),
});

/** `POST /v1/chain/logs` (EVM `eth_getLogs`): decoded when `event` names the signature. */
export const chainLogsRequestSchema = z.object({
  chain: caip2Schema,
  address: z.string().min(1).optional(),
  /** e.g. "Transfer(address indexed from, address indexed to, uint256 value)". */
  event: z.string().min(1).optional(),
  topics: z.array(z.string().nullable()).optional(),
  from_block: blockTagSchema,
  to_block: blockTagSchema.optional(),
});

/** `POST /v1/chain/name`: ENS (Ethereum) or Basename (Base), forward from a name or reverse from an address. */
export const chainNameRequestSchema = z.union([
  z.object({ chain: caip2Schema, name: z.string().min(1) }),
  z.object({ chain: caip2Schema, address: z.string().min(1) }),
]);

/** `POST /v1/markets`: prediction-market odds for a question, with the news around it. */
export const marketsRequestSchema = z.object({
  query: z.string().min(1).max(MARKET_QUERY_MAX_CHARS),
  limit: z.number().int().min(1).max(MARKETS_LIMIT_MAX).default(MARKETS_LIMIT_DEFAULT),
  /** Only one source ("polymarket", "jupiter"); both when absent. */
  provider: z.string().min(1).optional(),
});

/** `POST /v1/earn/vaults`: where a token earns most (LI.FI Earn). */
export const earnVaultsRequestSchema = z.object({
  chain: caip2Schema.optional(),
  /** Underlying token by symbol or address ("USDC"). */
  token: z.string().min(1).optional(),
  sort: z.enum(["apy", "tvl"]).default("apy"),
  limit: z.number().int().min(1).max(VAULTS_LIMIT_MAX).default(VAULTS_LIMIT_DEFAULT),
});

/** `POST /v1/earn/positions`: an address's Earn positions. */
export const earnPositionsRequestSchema = z.object({ address: z.string().min(1), chain: caip2Schema.optional() });

/**
 * The catalog connector each read alias forwards to, by chain family (plan B13: "ids fixed in the Wave 0 contracts").
 * L2 registers these ids as free tools; the gateway picks the EVM or Solana one from the request's chain.
 */
export const READ_ALIAS_CONNECTORS = {
  chainBalance: { evm: "chain-evm/balance", solana: "chain-solana/balance" },
  chainToken: { evm: "chain-evm/token", solana: "chain-solana/token" },
  chainTx: { evm: "chain-evm/tx", solana: "chain-solana/tx" },
  chainBlock: { evm: "chain-evm/block", solana: null },
  chainGas: { evm: "chain-evm/gas", solana: "chain-solana/gas" },
  chainCall: { evm: "chain-evm/call", solana: null },
  chainLogs: { evm: "chain-evm/logs", solana: null },
  chainName: { evm: "chain-evm/name", solana: null },
  markets: { any: "hako/markets" },
  earnVaults: { any: "lifi-earn/vaults" },
  earnPositions: { any: "lifi-earn/positions" },
} as const;
export type ReadAliasKey = keyof typeof READ_ALIAS_CONNECTORS;
