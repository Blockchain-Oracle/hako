import { z } from "zod";

import {
  ACTION_LABEL_MAX_CHARS,
  SUGGESTION_LABEL_MAX_CHARS,
  SUGGESTION_PROMPT_MAX_CHARS,
  SUGGESTIONS_MAX,
} from "./contract.config.ts";
import { intentSchema } from "./intent.ts";
import { cardPhaseSchema } from "./phase.ts";
import { payboxRequestStatusSchema } from "./request-status.ts";
import { isoTimeSchema, jsonObjectSchema, priceSchema, tokenAmountSchema, txLinkSchema, urlSchema } from "./primitives.ts";

/**
 * The envelope every card carries beside its data (plan §2: `structuredContent {kind, data, envelope}`): the phase,
 * the intent or PayBox request it follows, where a catalog answer came from, the receipt line of a paid run, the one
 * named fix when it is blocked, and the next-step chips. The same object in `/agent`, the MCP view and the CLI.
 */

/** A next-step chip ("bridge the rest", "earn on it", "check balance"): tapping it sends `prompt` as the person's turn. */
export const suggestionSchema = z.object({
  label: z.string().min(1).max(SUGGESTION_LABEL_MAX_CHARS),
  prompt: z.string().min(1).max(SUGGESTION_PROMPT_MAX_CHARS),
});
export type Suggestion = z.output<typeof suggestionSchema>;

/** What a card button does: open a link (PayBox's approval page, a buy link), run a tool, or send a prompt. */
export const cardActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("link"), label: z.string().min(1).max(ACTION_LABEL_MAX_CHARS), url: urlSchema }),
  z.object({ type: z.literal("tool"), label: z.string().min(1).max(ACTION_LABEL_MAX_CHARS), tool: z.string().min(1), input: jsonObjectSchema }),
  z.object({ type: z.literal("prompt"), label: z.string().min(1).max(ACTION_LABEL_MAX_CHARS), prompt: z.string().min(1).max(SUGGESTION_PROMPT_MAX_CHARS) }),
]);
export type CardAction = z.output<typeof cardActionSchema>;

/**
 * The one named fix of a blocked card (plan D21 "blocked CTA with one named fix", add-ons "Agent passport"): connect or
 * reconnect PayBox, add money (the Fund card), raise the limit (`request_account_change` → `manage_url`), top up gas,
 * retry, take a fresh quote, or move the draft to a network Hako executes on (R17: "Hako can't move money from
 * Ethereum yet" → "Switch to Base").
 */
export const CARD_FIXES = [
  "connect_paybox",
  "reconnect_paybox",
  "add_money",
  "raise_limit",
  "top_up_gas",
  "retry",
  "fresh_quote",
  "change_network",
] as const;
export type CardFix = (typeof CARD_FIXES)[number];
export const cardFixSchema = z.enum(CARD_FIXES);

/** A fix and the button that applies it (a failure card, an activity row stopped at the limit). */
export const namedFixSchema = z.object({ fix: cardFixSchema, action: cardActionSchema });
export type NamedFix = z.output<typeof namedFixSchema>;

export const blockedSchema = z.object({
  /** In words: "Your agent stopped at your limit", "Not enough USDC on Base", "Hako can't move money from Ethereum yet". */
  reason: z.string().min(1),
  fix: cardFixSchema,
  action: cardActionSchema,
});
export type Blocked = z.output<typeof blockedSchema>;

/** One upstream a catalog answer touched (hako_core SourceRef). */
export const sourceRefSchema = z.looseObject({
  name: z.string(),
  status: z.string().optional(),
  url: z.string().optional(),
  licence: z.string().optional(),
  attribution: z.string().optional(),
  as_of: z.string().optional(),
});
export type SourceRef = z.output<typeof sourceRefSchema>;

/** Where a catalog answer came from: the run envelope's safe metadata, lifted beside the card's data. */
export const runSourceSchema = z.object({
  endpoint: z.string().min(1),
  provider: z.string().min(1),
  found: z.boolean(),
  billable: z.boolean().nullable(),
  cached: z.boolean(),
  asOf: z.string().nullable(),
  elapsedMs: z.number().nullable(),
  price: priceSchema.nullable(),
  notes: z.array(z.string()),
  sources: z.array(sourceRefSchema),
});
export type RunSource = z.output<typeof runSourceSchema>;

/** The receipt line under a paid result (plan §1 card flow step 1: amount, chain, tx link) and its PayBox request. */
export const paymentLineSchema = z.object({
  amount: tokenAmountSchema,
  tx: txLinkSchema.nullable(),
  requestId: z.string().nullable(),
});
export type PaymentLine = z.output<typeof paymentLineSchema>;

/** The PayBox request a card follows, named on the card (plan §1 card flow step 3). */
export const requestRefSchema = z.object({
  id: z.string().min(1),
  status: payboxRequestStatusSchema,
  /** "Approve in PayBox": PayBox's approval page, only while the request waits at `pending_approval`. */
  approvalUrl: urlSchema.nullable(),
  /** Hako's `/sign/<id>` page hosting PayBox's signing window, while the request waits at `pending_signature`. */
  signUrl: urlSchema.nullable(),
});
export type RequestRef = z.output<typeof requestRefSchema>;

/** "Inside your limits" (plan D21): whether the grant lets this run without a passkey, in words. */
export const limitsChipSchema = z.object({ inside: z.boolean(), note: z.string().min(1) });

export const cardEnvelopeSchema = z.object({
  phase: cardPhaseSchema,
  /** Money cards: the draft version the card shows; a reopened conversation re-reads it, never the stale draft. */
  intent: intentSchema.optional(),
  request: requestRefSchema.optional(),
  source: runSourceSchema.optional(),
  payment: paymentLineSchema.optional(),
  blocked: blockedSchema.optional(),
  limits: limitsChipSchema.optional(),
  suggestions: z.array(suggestionSchema).max(SUGGESTIONS_MAX),
  updatedAt: isoTimeSchema,
});
export type CardEnvelope = z.output<typeof cardEnvelopeSchema>;
