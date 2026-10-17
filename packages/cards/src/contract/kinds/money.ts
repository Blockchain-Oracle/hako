import { z } from "zod";

import { ROUTE_RACE_MAX_ROUTES } from "../contract.config.ts";
import { draftRefSchema, intentStateSchema } from "../intent.ts";
import {
  atomicSchema,
  caip2Schema,
  isoTimeSchema,
  jsonObjectSchema,
  tokenAmountSchema,
  tokenRefSchema,
  urlSchema,
  usdSchema,
  walletRefSchema,
} from "../primitives.ts";

/**
 * Money cards (plan §1 "The card flow", binding): the pay card of a paid tool, the route (a LI.FI quote) and the route
 * race, and the editable drafts (send, swap, bridge, earn deposit and withdraw). Hako makes these itself, so they are
 * strict camelCase objects. A draft card shows one draft version; every edit makes a new version that is re-quoted
 * and re-rehearsed in the same card.
 */

/**
 * What a draft version was quoted at: @hako/paybox's `DraftQuote`, field for field (@hako/agent checks they stay
 * equal). Sends, runs and invoice payments carry a price but no LI.FI tool.
 */
export const draftQuoteSchema = z.object({
  tool: z.string().nullable(),
  fromAmountAtomic: atomicSchema,
  toAmountAtomic: atomicSchema,
  /** R15: a fresh quote below this minimum goes back for review instead of becoming a proposal. */
  toAmountMinAtomic: atomicSchema,
  feeUsd: usdSchema.nullable(),
  estimatedDurationS: z.number().min(0).nullable(),
  /** The spender of the exact approve that must come first (R16: "Step 1 of 2"), or null when none is needed. */
  approvalAddress: z.string().nullable(),
  quotedAt: isoTimeSchema,
  expiresAt: isoTimeSchema,
});
export type DraftQuoteData = z.output<typeof draftQuoteSchema>;

/**
 * The rehearsal line (plan B13 `/v1/rehearse`): @hako/paybox's `Rehearsal`. `skipped` = over the rehearsal budget;
 * `unsupported` = "Not rehearsed on <chain>", never shown as a pass.
 */
export const REHEARSAL_STATUSES = ["passed", "failed", "skipped", "unsupported"] as const;
export const rehearsalSchema = z.object({
  status: z.enum(REHEARSAL_STATUSES),
  /** `id:version`: a rehearsal belongs to exactly one draft version. */
  key: z.templateLiteral([z.string(), ":", z.number()]),
  chain: caip2Schema,
  reason: z.string().optional(),
  simulatedAt: isoTimeSchema.optional(),
});
export type RehearsalData = z.output<typeof rehearsalSchema>;

export const routeFeeSchema = z.object({
  /** "LI.FI fee", "Bridge fee", "Gas"… as the route names it. */
  name: z.string().min(1),
  amount: tokenAmountSchema,
  /** Paid on top of the amount sent (gas), or taken out of it (protocol fees). */
  included: z.boolean(),
});

/**
 * A LI.FI route, normalised (the `route` kind; `POST /v1/quote`). It carries every `DraftQuote` field under the same
 * name, so a route can stand wherever a draft's quote is expected, plus what the card shows around it.
 */
export const routeDataSchema = draftQuoteSchema.extend({
  /** The LI.FI tool (bridge or exchange key) this route uses; R15 refuses a fresh quote whose tool differs. */
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
  /** Only single-transaction routes are offered. */
  steps: z.number().int().min(1),
  rehearsal: rehearsalSchema.nullable(),
});
export type RouteData = z.output<typeof routeDataSchema>;

export const ROUTE_RACE_ROW_STATUSES = ["asking", "answered", "failed", "timed_out"] as const;

export const routeRaceRowSchema = z.object({
  tool: z.string().min(1),
  toolName: z.string().min(1),
  logoUrl: urlSchema.nullable(),
  status: z.enum(ROUTE_RACE_ROW_STATUSES),
  toAmountAtomic: atomicSchema.nullable(),
  toAmountMinAtomic: atomicSchema.nullable(),
  feeUsd: usdSchema.nullable(),
  estimatedDurationS: z.number().min(0).nullable(),
  /** Why a route has no answer, in words ("No single-transaction route", "Timed out after 4 s"). */
  reason: z.string().nullable(),
});

/**
 * One snapshot of the route race (add-ons "Route race": one LI.FI `/quote` per contender bridge, in parallel, 4 s each
 * and 8 s in all; "Asking 5 routes · 3/5 answered"). The winner is the most received after fees; the person may pick
 * another row before signing, and its `tool` is pinned from then on.
 */
export const routeRaceDataSchema = z.object({
  raceId: z.string().min(1),
  fromChain: caip2Schema,
  toChain: caip2Schema,
  fromToken: tokenRefSchema,
  toToken: tokenRefSchema,
  fromAmountAtomic: atomicSchema,
  asked: z.number().int().min(0).max(ROUTE_RACE_MAX_ROUTES),
  answered: z.number().int().min(0).max(ROUTE_RACE_MAX_ROUTES),
  done: z.boolean(),
  rows: z.array(routeRaceRowSchema).max(ROUTE_RACE_MAX_ROUTES),
  winner: z.string().nullable(),
});
export type RouteRaceData = z.output<typeof routeRaceDataSchema>;

/** Every draft card: which version it shows, its intent state, the version's quote and rehearsal. */
const draftBase = draftRefSchema.extend({
  state: intentStateSchema,
  quote: draftQuoteSchema.nullable(),
  rehearsal: rehearsalSchema.nullable(),
  createdAt: isoTimeSchema,
  updatedAt: isoTimeSchema,
});

/** A send (ERC-20 `transfer`, native value, SPL transfer) through PayBox `request_transfer` (plan D25, J9). */
export const sendDraftDataSchema = draftBase.extend({
  chain: caip2Schema,
  amount: tokenAmountSchema,
  from: walletRefSchema,
  /** The resolved recipient, labelled with what the person called it ("Tobi", "tobi.paybox"). */
  to: walletRefSchema,
});
export type SendDraftData = z.output<typeof sendDraftDataSchema>;

/**
 * A LI.FI swap (one chain) or bridge (two chains): the `swap_draft` and `bridge_draft` kinds share this shape. R15
 * binds every field of it: chains, sender, recipient, tokens, amount and the LI.FI tool.
 */
export const routeDraftDataSchema = draftBase.extend({
  fromChain: caip2Schema,
  toChain: caip2Schema,
  amount: tokenAmountSchema,
  toToken: tokenRefSchema,
  from: walletRefSchema,
  to: walletRefSchema,
  /** The route-race row picked, pinned on every later quote; null until a route is chosen. */
  tool: z.string().nullable(),
});
export type RouteDraftData = z.output<typeof routeDraftDataSchema>;

/** A LI.FI Earn deposit or withdraw (EVM; plan A8, J3): the `earn_deposit_draft` and `earn_withdraw_draft` kinds. */
export const earnDraftDataSchema = draftBase.extend({
  chain: caip2Schema,
  vault: z.object({
    address: z.string().min(1),
    name: z.string().nullable(),
    protocol: z.string().nullable(),
    apy: z.number().nullable(),
  }),
  amount: tokenAmountSchema,
  wallet: walletRefSchema,
});
export type EarnDraftData = z.output<typeof earnDraftDataSchema>;

/**
 * A paid tool's pay card (plan §1 card flow step 1): tool, provider, price, and "Pay $0.005". Nothing is paid until
 * its button calls `hako_execute` with this draft version; PayBox then pays `paidUrl` with `use_service`.
 */
export const payDataSchema = draftRefSchema.extend({
  state: intentStateSchema,
  tool: z.object({
    id: z.string().min(1),
    displayName: z.string().min(1),
    provider: z.string().min(1),
    providerName: z.string().min(1),
    render: z.string().min(1),
    summary: z.string(),
  }),
  /** The catalog's exact price for one call, in USDC on Base. */
  price: tokenAmountSchema,
  paidUrl: urlSchema,
  method: z.literal("POST"),
  input: jsonObjectSchema,
});
export type PayData = z.output<typeof payDataSchema>;
