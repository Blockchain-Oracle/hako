import { BATCH_MAX_CALLS, INVOICE_NOTE_MAX_CHARS } from "@hako/config";
import { z } from "zod";

import { ACTIVITY_PAGE_DEFAULT, ACTIVITY_PAGE_MAX, ROUTE_RACE_MAX_ROUTES, SIGNED_TX_MAX_CHARS, TOOL_ID_MAX_CHARS } from "../contract.config.ts";
import { draftRefSchema } from "../intent.ts";
import { anyRunEnvelopeSchema } from "../kinds/catalog.ts";
import { routeDataSchema } from "../kinds/money.ts";
import { receiptDataSchema } from "../kinds/outcome.ts";
import { moneyMovedSchema } from "../phase.ts";
import {
  addressSchema,
  atomicSchema,
  caip2Schema,
  evmAddressSchema,
  isoTimeSchema,
  jsonObjectSchema,
  solanaAddressSchema,
  tokenRefSchema,
  txHashSchema,
  urlSchema,
  usdSchema,
} from "../primitives.ts";

/**
 * Request and response bodies of the gateway's money routes (plan B12, B13; L1 implements them). Hako's own JSON:
 * camelCase, atomic amounts as integer strings, chains as CAIP-2, tokens by address.
 */

/** What every LI.FI quote is asked for: R15 binds each of these fields on the fresh quote. */
export const routeRequestSchema = z.object({
  fromChain: caip2Schema,
  toChain: caip2Schema,
  /** Token contract or mint (the native coin's LI.FI address for ETH or SOL). */
  fromToken: z.string().min(1),
  toToken: z.string().min(1),
  fromAmountAtomic: atomicSchema,
  /** The wallet that signs: the address of the PayBox wallet passed as `use_plugin.wallet_id`. */
  fromAddress: addressSchema,
  toAddress: addressSchema,
});

/** `POST /v1/quote`: one LI.FI route (pinned to `tool` when given: `allowBridges=[tool]`), with its rehearsal line. */
export const quoteRequestSchema = routeRequestSchema.extend({
  tool: z.string().min(1).optional(),
  /** Rehearsal is keyed by `id:version`; without a draft the quote comes back unrehearsed. */
  draft: draftRefSchema.optional(),
});
export const quoteResponseSchema = routeDataSchema;

/** `POST /v1/routes`: the route race, streamed as NDJSON snapshots (routeRaceDataSchema per line). */
export const routesRequestSchema = routeRequestSchema.extend({
  /** Contender bridges to ask; the gateway's own list when absent. */
  tools: z.array(z.string().min(1)).min(1).max(ROUTE_RACE_MAX_ROUTES).optional(),
});

/** One EVM call as PayBox proposes it (`io.paybox/transactionProposal`: one call per proposal). */
export const evmCallSchema = z.object({
  chainId: z.number().int().min(1),
  to: evmAddressSchema,
  data: z.string().regex(/^0x([0-9a-fA-F]{2})*$/, "0x-prefixed hex calldata"),
  value: atomicSchema,
  gas: atomicSchema.optional(),
});

/** One Solana transaction: at most 1,232 bytes with exactly one signer, the sender, and no prefilled signature. */
export const solanaTxSchema = z.object({
  transactionBase64: z.string().min(1),
  signer: solanaAddressSchema,
  bytes: z.number().int().min(1),
});

/**
 * What a money proposal route answers (`/v1/bridge`, `/v1/earn/deposit`, `/v1/earn/withdraw`):
 * - approve: the allowance is short; only the exact-amount approve comes back (R16, "Step 1 of 2: when this request
 *   reaches success, call again with the same input");
 * - transfer: a fresh quote pinned to the reviewed tool passed R15, and its transaction;
 * - review: the fresh quote's minimum is below the reviewed one, so it goes back to the person instead of a proposal.
 */
export const proposalResponseSchema = z.discriminatedUnion("step", [
  z.object({
    step: z.literal("approve"),
    chain: caip2Schema,
    token: tokenRefSchema,
    spender: evmAddressSchema,
    amountAtomic: atomicSchema,
    tx: evmCallSchema,
  }),
  z.object({ step: z.literal("transfer"), route: routeDataSchema, tx: z.union([evmCallSchema, solanaTxSchema]) }),
  z.object({ step: z.literal("review"), route: routeDataSchema, reason: z.string().min(1) }),
]);

/** `POST /v1/bridge`: the reviewed route's input, its LI.FI tool and the reviewed minimum (R15). */
export const bridgeRequestSchema = routeRequestSchema.extend({
  tool: z.string().min(1),
  minReceivedAtomic: atomicSchema,
});

/** `GET /v1/bridge/status`: LI.FI status for a source transaction. */
export const bridgeStatusQuerySchema = z.object({
  txHash: txHashSchema,
  fromChain: caip2Schema,
  toChain: caip2Schema.optional(),
  tool: z.string().min(1).optional(),
});

const bridgeLegSchema = z.object({
  chain: caip2Schema,
  txHash: txHashSchema.nullable(),
  amountAtomic: atomicSchema.nullable(),
  token: tokenRefSchema.nullable(),
  explorerUrl: urlSchema.nullable(),
});

export const bridgeStatusResponseSchema = z.object({
  status: z.enum(["pending", "done", "failed", "not_found"]),
  /** LI.FI's substatus (`COMPLETED`, `PARTIAL`, `REFUNDED`…) and its message, as LI.FI words them. */
  substatus: z.string().nullable(),
  substatusMessage: z.string().nullable(),
  tool: z.string().nullable(),
  sending: bridgeLegSchema,
  receiving: bridgeLegSchema.nullable(),
});

/** `POST /v1/earn/deposit` and `/v1/earn/withdraw` (LI.FI Composer, EVM): the same input contract and approve sequence. */
export const earnMoveRequestSchema = z.object({
  chain: caip2Schema,
  vault: evmAddressSchema,
  token: z.string().min(1),
  amountAtomic: atomicSchema,
  fromAddress: evmAddressSchema,
  /** The reviewed quote's minimum (vault shares on deposit, tokens on withdraw): R15's floor. */
  minReceivedAtomic: atomicSchema,
  tool: z.string().min(1).optional(),
});

/** `POST /v1/rehearse` (free, cached by `id:version`): approve + transfer simulated together, or one Solana tx. */
export const rehearseRequestSchema = z.union([
  draftRefSchema.extend({
    chain: caip2Schema,
    from: evmAddressSchema,
    calls: z.array(evmCallSchema.omit({ chainId: true })).min(1),
  }),
  draftRefSchema.extend({ chain: caip2Schema, from: solanaAddressSchema, transactionBase64: z.string().min(1) }),
]);

/** `POST /v1/broadcast`: a PayBox-signed transaction with the draft version it must equal (the only sender of signed txs). */
export const broadcastRequestSchema = draftRefSchema.extend({
  chain: caip2Schema,
  /** The signed tx: EVM `serializedTransaction` (0x hex) or Solana `signedTransactionBase64`. */
  signedTx: z.string().min(1).max(SIGNED_TX_MAX_CHARS),
});

export const broadcastResponseSchema = z.object({
  /** sent: on its way; already_known: this exact tx was sent before (a no-op); refused: never sent. */
  status: z.enum(["sent", "already_known", "refused"]),
  txHash: txHashSchema.nullable(),
  explorerUrl: urlSchema.nullable(),
  /** Why a tx was refused: "Signed but not sent — no money moved" (stale nonce, expired blockhash, failing simulation). */
  reason: z.string().nullable(),
  moneyMoved: moneyMovedSchema,
});

/** `POST /v1/batch` (free): validates every call, freezes the summed price, stores it for BATCH_TTL_S. */
export const batchRequestSchema = z.object({
  calls: z
    .array(z.object({ id: z.string().min(1).max(TOOL_ID_MAX_CHARS), input: jsonObjectSchema }))
    .min(1)
    .max(BATCH_MAX_CALLS),
});
export const batchResponseSchema = z.object({
  batchId: z.string().min(1),
  priceAtomic: atomicSchema,
  priceUsd: usdSchema,
  network: caip2Schema,
  expiresAt: isoTimeSchema,
  calls: z.array(z.object({ id: z.string().min(1), priceAtomic: atomicSchema })),
  /** `GET <gateway>/v2/batch/<batchId>`: what PayBox pays, once. */
  paidUrl: urlSchema,
});

/** `GET /v2/batch/<batchId>` (x402, one-time): settles only if every call succeeded. */
export const batchResultSchema = z.object({
  batchId: z.string().min(1),
  results: z.array(z.object({ id: z.string().min(1), envelope: anyRunEnvelopeSchema })),
});

/** `POST /v1/invoices` (free, rate-limited per IP): Base USDC, paid straight to `payTo`. */
export const invoiceCreateRequestSchema = z.object({
  amountAtomic: atomicSchema,
  /** Plain text, shown to the payer. */
  note: z.string().max(INVOICE_NOTE_MAX_CHARS).optional(),
  /** The payee wallet's address, read from PayBox `list_credentials`. */
  payTo: evmAddressSchema,
});

export const idParamsSchema = z.object({ id: z.string().min(1) });

/** `GET /v1/receipts`: the caller's own receipts, newest first (query values arrive as strings, so numbers coerce). */
export const receiptsQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number<string | number>().int().min(1).max(ACTIVITY_PAGE_MAX).default(ACTIVITY_PAGE_DEFAULT),
});
export const receiptsPageSchema = z.object({
  receipts: z.array(receiptDataSchema),
  nextCursor: z.string().nullable(),
});

/** `POST /v1/receipts` (`hako_receipt {chain, txHash}`): checked on chain, then recorded for the caller. */
export const receiptCreateRequestSchema = z.object({
  chain: caip2Schema,
  txHash: txHashSchema,
  draft: draftRefSchema.optional(),
});
