import { z } from "zod";

import { namedFixSchema } from "../envelope.ts";
import { draftKindSchema, intentStateSchema } from "../intent.ts";
import { moneyMovedSchema, moveStageSchema } from "../phase.ts";
import { payboxRequestStatusSchema, requestWaitSchema } from "../request-status.ts";
import { isoTimeSchema, tokenAmountSchema, txLinkSchema, urlSchema, usdSchema } from "../primitives.ts";

/**
 * How a move ends up (plan §1 card flow steps 3–4): the live status (approval, signing, sent, arriving), the receipt
 * (what arrived, both tx hashes, the PayBox request id, the fee) and the failure card that always says whether money
 * moved. Hako-made, strict camelCase.
 */

/**
 * A draft version's live status: `hako_execute`, `hako_request_status`, `hako_broadcast`. Re-read from the store and
 * PayBox on every mount, never from the draft alone.
 */
export const statusDataSchema = z.object({
  draftId: z.string().nullable(),
  version: z.number().int().min(1).nullable(),
  kind: draftKindSchema.nullable(),
  state: intentStateSchema.nullable(),
  requestId: z.string().nullable(),
  requestStatus: payboxRequestStatusSchema.nullable(),
  waitsOn: requestWaitSchema.nullable(),
  stage: moveStageSchema.nullable(),
  /** "Approve in PayBox" (`pending_approval` only). */
  approvalUrl: urlSchema.nullable(),
  /** Hako's `/sign/<id>` page hosting PayBox's signing window (`pending_signature`). */
  signUrl: urlSchema.nullable(),
  txs: z.array(txLinkSchema),
  /** "Signed but not sent — no money moved", "Checking whether this went through"… */
  reason: z.string().nullable(),
  /** True when the execute found this version's request already created and created nothing. */
  reused: z.boolean(),
  /** The receipt this move is recorded as while it still settles; once it confirms or reverts the card turns into it. */
  receiptId: z.string().nullable(),
  updatedAt: isoTimeSchema,
});
export type StatusData = z.output<typeof statusDataSchema>;

/** What a receipt records. */
export const RECEIPT_KINDS = ["run", "batch", "send", "swap", "bridge", "earn_deposit", "earn_withdraw", "invoice", "approve"] as const;
export type ReceiptKind = (typeof RECEIPT_KINDS)[number];
export const receiptKindSchema = z.enum(RECEIPT_KINDS);

/** Where a receipt stands on chain: still settling, or its end. */
export const RECEIPT_STATUSES = ["confirmed", "reverted", "pending"] as const;
export type ReceiptStatus = (typeof RECEIPT_STATUSES)[number];
export const receiptStatusSchema = z.enum(RECEIPT_STATUSES);

/** Where Hako did something (plan add-ons "Activity ledger": the surface filter). */
export const ACTIVITY_SURFACES = ["web", "mcp", "cli", "plugin", "voice"] as const;
export type ActivitySurface = (typeof ACTIVITY_SURFACES)[number];
export const activitySurfaceSchema = z.enum(ACTIVITY_SURFACES);

/** A receipt (`@hako/db` row; `/r/<id>` when shared): the button morphs into it (Kawase TxMorph). */
export const receiptDataSchema = z.object({
  id: z.string().min(1),
  kind: receiptKindSchema,
  /** The verb line: "Paid Exa", "Bridged 5 USDC Base → Solana", "Invoice paid by @tobi". */
  title: z.string().min(1),
  status: receiptStatusSchema,
  sent: tokenAmountSchema.nullable(),
  received: tokenAmountSchema.nullable(),
  feeUsd: usdSchema.nullable(),
  txs: z.array(txLinkSchema),
  requestId: z.string().nullable(),
  draftId: z.string().nullable(),
  /** The public `/r/<id>` page, when the person shared it. */
  shareUrl: urlSchema.nullable(),
  /** The surface the move was made from; null for a settlement Hako saw from outside (a plugin payment in another host). */
  surface: activitySurfaceSchema.nullable(),
  at: isoTimeSchema,
});
export type ReceiptData = z.output<typeof receiptDataSchema>;

/** A failure card (plan §1 card flow step 4, D21): what failed, whether money moved, and one named fix. */
export const failureDataSchema = z.object({
  title: z.string().min(1),
  reason: z.string().min(1),
  moneyMoved: moneyMovedSchema,
  requestId: z.string().nullable(),
  txs: z.array(txLinkSchema),
  fix: namedFixSchema.nullable(),
  /** The technical text, behind a disclosure. */
  technical: z.string().nullable(),
});
export type FailureData = z.output<typeof failureDataSchema>;
