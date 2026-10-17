import { z } from "zod";

import { LOGS_MAX_ROWS } from "../contract.config.ts";
import { atomicSchema, caip2Schema } from "../primitives.ts";

/**
 * Chain read render kinds (plan C17, C18; midl parity, public RPCs): balance, token, tx_receipt, block, gas,
 * contract_read, logs, plus chain_name for ENS / Basename lookups. Produced by L2's `chain-evm/*` and `chain-solana/*`
 * connectors and served free through the gateway's `/v1/chain/*` aliases. snake_case, loose, CAIP-2 chains, atomic
 * amounts as integer strings.
 */

const text = z.string();
const blockNumber = z.number().int().min(0);

export const balanceRowSchema = z.looseObject({
  symbol: text,
  /** The token contract or mint; the native coin's address as LI.FI names it. */
  address: text,
  decimals: z.number().int().min(0),
  amount_atomic: atomicSchema,
  /** The same amount in token units, exact ("1.25"). */
  amount: text,
  name: text.optional(),
  usd: z.number().optional(),
});

/** What an address holds on one chain (native coin, USDC, any token asked for; SPL tokens on Solana). */
export const balanceDataSchema = z.looseObject({
  chain: caip2Schema,
  address: text,
  balances: z.array(balanceRowSchema),
  block_number: blockNumber.optional(),
});

/** One token's facts (ERC-20 or SPL mint). */
export const tokenDataSchema = z.looseObject({
  chain: caip2Schema,
  address: text,
  symbol: text,
  name: text,
  decimals: z.number().int().min(0),
  standard: text.optional(),
  total_supply_atomic: atomicSchema.optional(),
  logo_url: text.optional(),
  price_usd: z.number().optional(),
  verified: z.boolean().optional(),
});

/** A transaction and its receipt (EVM receipt; Solana signature status). */
export const txReceiptDataSchema = z.looseObject({
  chain: caip2Schema,
  hash: text,
  status: z.enum(["success", "reverted", "pending", "not_found"]),
  block_number: blockNumber.optional(),
  from: text.optional(),
  to: text.optional(),
  value_atomic: atomicSchema.optional(),
  gas_used: atomicSchema.optional(),
  fee_atomic: atomicSchema.optional(),
  timestamp: text.optional(),
  confirmations: z.number().int().min(0).optional(),
  explorer_url: text.optional(),
  transfers: z
    .array(z.looseObject({ token: text, from: text, to: text, amount_atomic: atomicSchema, symbol: text.optional(), decimals: z.number().int().optional() }))
    .optional(),
});

export const blockDataSchema = z.looseObject({
  chain: caip2Schema,
  number: blockNumber,
  hash: text,
  timestamp: text,
  tx_count: z.number().int().min(0),
  gas_used: atomicSchema.optional(),
  gas_limit: atomicSchema.optional(),
  base_fee_gwei: z.number().optional(),
  miner: text.optional(),
  explorer_url: text.optional(),
});

/** Fees right now: EVM in gwei (base fee + priority levels), Solana in micro-lamports per compute unit. */
export const gasDataSchema = z.looseObject({
  chain: caip2Schema,
  unit: z.enum(["gwei", "micro_lamports"]),
  levels: z.array(z.looseObject({ label: text, max_fee: z.number(), priority_fee: z.number().optional(), usd: z.number().optional() })),
  base_fee: z.number().optional(),
  block_number: blockNumber.optional(),
});

/** A view call's result (`eth_call` with the function signature it was decoded by). */
export const contractReadDataSchema = z.looseObject({
  chain: caip2Schema,
  address: text,
  /** e.g. "balanceOf(address) returns (uint256)". */
  function: text,
  args: z.array(z.unknown()),
  result: z.unknown(),
  block_number: blockNumber.optional(),
});

export const logRowSchema = z.looseObject({
  block_number: blockNumber,
  tx_hash: text,
  log_index: z.number().int().min(0),
  address: text,
  topics: z.array(text),
  data: text,
  event: text.optional(),
  args: z.record(z.string(), z.unknown()).optional(),
});

/** Event logs in a block range (`eth_getLogs`), decoded when the event signature was given. */
export const logsDataSchema = z.looseObject({
  chain: caip2Schema,
  logs: z.array(logRowSchema).max(LOGS_MAX_ROWS),
  address: text.optional(),
  from_block: blockNumber.optional(),
  to_block: blockNumber.optional(),
  truncated: z.boolean().optional(),
});

/** A name ↔ address lookup: ENS on Ethereum, Basenames on Base. */
export const chainNameDataSchema = z.looseObject({
  chain: caip2Schema,
  name: text,
  address: text,
  service: z.enum(["ens", "basename"]),
  direction: z.enum(["forward", "reverse"]),
  avatar_url: text.optional(),
});
