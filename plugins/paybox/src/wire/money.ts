/**
 * The money routes' request and response bodies, mirrored from packages/cards/src/contract/gateway/money-schemas.ts and
 * kinds/{money,account}.ts (the one wire contract between plugin, gateway, web and MCP). Same names, same fields, same
 * rules on the plugin's own zod; only the parts the plugin sends or reads. Change both together.
 */
import * as z from "zod/v4";

import { BATCH_MAX_CALLS, INVOICE_NOTE_MAX_CHARS } from "../shared.js";
import {
  addressSchema,
  atomicSchema,
  caip2Schema,
  evmAddressSchema,
  isoTimeSchema,
  jsonObjectSchema,
  solanaAddressSchema,
  tokenAmountSchema,
  tokenRefSchema,
  txHashSchema,
  txLinkSchema,
  urlSchema,
  usdSchema,
} from "./primitives.js";
import { TOOL_ID_MAX_CHARS } from "./wire.config.js";

/** kinds/money.ts `draftQuoteSchema`. */
export const draftQuoteSchema = z.object({
  tool: z.string().nullable(),
  fromAmountAtomic: atomicSchema,
  toAmountAtomic: atomicSchema,
  toAmountMinAtomic: atomicSchema,
  feeUsd: usdSchema.nullable(),
  estimatedDurationS: z.number().min(0).nullable(),
  approvalAddress: z.string().nullable(),
  quotedAt: isoTimeSchema,
  expiresAt: isoTimeSchema,
});

/** kinds/money.ts `rehearsalSchema`: `skipped` = over budget, `unsupported` = "Not rehearsed on <chain>". */
export const rehearsalSchema = z.object({
  status: z.enum(["passed", "failed", "skipped", "unsupported"]),
  key: z.templateLiteral([z.string(), ":", z.number()]),
  chain: caip2Schema,
  reason: z.string().optional(),
  simulatedAt: isoTimeSchema.optional(),
});

export const routeFeeSchema = z.object({
  name: z.string().min(1),
  amount: tokenAmountSchema,
  included: z.boolean(),
});

/** kinds/money.ts `routeDataSchema`: one LI.FI route, normalised (`POST /v1/quote`). */
export const routeDataSchema = draftQuoteSchema.extend({
  tool: z.string().min(1),
  toolName: z.string().min(1),
  toolLogoUrl: urlSchema.nullable(),
  fromChain: caip2Schema,
  toChain: caip2Schema,
  fromToken: tokenRefSchema,
  toToken: tokenRefSchema,
  fromAddress: z.string().min(1),
  toAddress: z.string().min(1),
  fromAmountUsd: usdSchema.nullable(),
  toAmountUsd: usdSchema.nullable(),
  gasUsd: usdSchema.nullable(),
  fees: z.array(routeFeeSchema),
  steps: z.number().int().min(1),
  rehearsal: rehearsalSchema.nullable(),
});
export type RouteData = z.output<typeof routeDataSchema>;

/** What every LI.FI quote is asked for: R15 binds each of these fields on the fresh quote. */
export const routeRequestSchema = z.object({
  fromChain: caip2Schema,
  toChain: caip2Schema,
  fromToken: z.string().min(1),
  toToken: z.string().min(1),
  fromAmountAtomic: atomicSchema,
  fromAddress: addressSchema,
  toAddress: addressSchema,
});

/** `POST /v1/quote` (the plugin never sends the optional `draft`: it has no drafts). */
export const quoteRequestSchema = routeRequestSchema.extend({ tool: z.string().min(1).optional() });

export const evmCallSchema = z.object({
  chainId: z.number().int().min(1),
  to: evmAddressSchema,
  data: z.string().regex(/^0x([0-9a-fA-F]{2})*$/, "0x-prefixed hex calldata"),
  value: atomicSchema,
  gas: atomicSchema.optional(),
});
export type EvmCall = z.output<typeof evmCallSchema>;

export const solanaTxSchema = z.object({
  transactionBase64: z.string().min(1),
  signer: solanaAddressSchema,
  bytes: z.number().int().min(1),
});

/** `/v1/bridge`, `/v1/earn/deposit`, `/v1/earn/withdraw`: the exact approve, the bound transfer, or a quote to review. */
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
export type ProposalResponse = z.output<typeof proposalResponseSchema>;

/** `POST /v1/bridge`: the reviewed route's input, its LI.FI tool and the reviewed minimum (R15). */
export const bridgeRequestSchema = routeRequestSchema.extend({
  tool: z.string().min(1),
  minReceivedAtomic: atomicSchema,
});
export type BridgeRequest = z.output<typeof bridgeRequestSchema>;

/** `GET /v1/bridge/status`. */
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
  substatus: z.string().nullable(),
  substatusMessage: z.string().nullable(),
  tool: z.string().nullable(),
  sending: bridgeLegSchema,
  receiving: bridgeLegSchema.nullable(),
});

/** `POST /v1/earn/deposit` and `/v1/earn/withdraw` (LI.FI Composer, EVM). */
export const earnMoveRequestSchema = z.object({
  chain: caip2Schema,
  vault: evmAddressSchema,
  token: z.string().min(1),
  amountAtomic: atomicSchema,
  fromAddress: evmAddressSchema,
  minReceivedAtomic: atomicSchema,
  tool: z.string().min(1).optional(),
});
export type EarnMoveRequest = z.output<typeof earnMoveRequestSchema>;

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
  paidUrl: urlSchema,
});

/** `POST /v1/invoices` (free, rate-limited per IP): Base USDC, paid straight to `payTo`. */
export const invoiceCreateRequestSchema = z.object({
  amountAtomic: atomicSchema,
  note: z.string().max(INVOICE_NOTE_MAX_CHARS).optional(),
  payTo: evmAddressSchema,
});

export const idParamsSchema = z.object({ id: z.string().min(1) });

/** kinds/account.ts `invoiceDataSchema`: `POST /v1/invoices`, `GET /v1/invoices/:id`, `GET /v2/invoice/:id`. */
export const invoiceDataSchema = z.object({
  id: z.string().min(1),
  status: z.enum(["open", "paid"]),
  amount: tokenAmountSchema,
  payTo: evmAddressSchema,
  note: z.string().nullable(),
  payUrl: urlSchema,
  agentPayUrl: urlSchema,
  qrPayload: z.string().min(1),
  createdBy: z.enum(["user", "agent"]),
  payer: z.string().nullable(),
  tx: txLinkSchema.nullable(),
  paidAt: isoTimeSchema.nullable(),
  createdAt: isoTimeSchema,
});
export type InvoiceData = z.output<typeof invoiceDataSchema>;
