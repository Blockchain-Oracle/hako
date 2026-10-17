import { z } from "zod";

import type { CardPhase, MoveStage } from "./phase.ts";

/**
 * A PayBox request's status, exactly as PayBox reports it: `RequestStatus` in @paybox-sh/sdk 2.2.0
 * (refs/paybox-sdk/package/dist/index.d.ts) and docs.paybox.sh/concepts/requests
 * (context/01-paybox-platform/request-lifecycle.md). Every request ends `success`, `denied` or `error`; PayBox has no
 * `expired` or `cancelled` status: an approval timeout comes back as one of those three, and Hako's own outcomes
 * (an expired draft, "Cancelled: reconnect PayBox") live in the intent state and the card phase instead.
 */
export const PAYBOX_REQUEST_STATUSES = [
  "pending_approval",
  "pending_funding",
  "pending_signature",
  "pending_settlement",
  "pending_confirmation",
  "success",
  "denied",
  "error",
] as const;
export type PayboxRequestStatus = (typeof PAYBOX_REQUEST_STATUSES)[number];
export const payboxRequestStatusSchema = z.enum(PAYBOX_REQUEST_STATUSES);

export type PendingRequestStatus = Extract<PayboxRequestStatus, `pending_${string}`>;
export type TerminalRequestStatus = Exclude<PayboxRequestStatus, PendingRequestStatus>;

export const TERMINAL_REQUEST_STATUSES: ReadonlySet<PayboxRequestStatus> = new Set<TerminalRequestStatus>(["success", "denied", "error"]);

export const isTerminalRequestStatus = (status: PayboxRequestStatus): status is TerminalRequestStatus =>
  TERMINAL_REQUEST_STATUSES.has(status);

/**
 * What a pending request waits on, for the card's words and its one action:
 * approval → "Approve in PayBox" (`approval_url`, passkey in the PayBox app); signature → PayBox's signing window;
 * funding → "Add money"; settlement and confirmation → keep following (a bridge settling, a broadcast confirming).
 */
export const REQUEST_WAITS_ON = {
  pending_approval: "approval",
  pending_funding: "funding",
  pending_signature: "signature",
  pending_settlement: "settlement",
  pending_confirmation: "confirmation",
} as const satisfies Record<PendingRequestStatus, string>;
export type RequestWait = (typeof REQUEST_WAITS_ON)[PendingRequestStatus];
export const REQUEST_WAITS = ["approval", "funding", "signature", "settlement", "confirmation"] as const satisfies readonly RequestWait[];
export const requestWaitSchema = z.enum(REQUEST_WAITS);

export const requestWaitsOn = (status: PayboxRequestStatus): RequestWait | null =>
  isTerminalRequestStatus(status) ? null : REQUEST_WAITS_ON[status];

const PHASE_BY_STATUS = {
  pending_approval: "live",
  pending_funding: "live",
  pending_signature: "live",
  pending_settlement: "live",
  pending_confirmation: "live",
  success: "result",
  denied: "denied",
  error: "error",
} as const satisfies Record<PayboxRequestStatus, CardPhase>;

/** The card phase for a PayBox request's status. `success` on an on-chain request means confirmed, never just sent. */
export const requestStatusToPhase = (status: PayboxRequestStatus): CardPhase => PHASE_BY_STATUS[status];

/**
 * The move stage a pending request shows. A terminal status has none here: `success` means "signed" for a wallet sign
 * (Hako's broadcast job then sends it) and "done" for a transfer or a paid run, so the caller decides from the draft.
 */
const STAGE_BY_PENDING = {
  pending_approval: "approval",
  pending_funding: "funding",
  pending_signature: "signing",
  pending_settlement: "arriving",
  pending_confirmation: "sent",
} as const satisfies Record<PendingRequestStatus, MoveStage>;

export const pendingRequestStage = (status: PayboxRequestStatus): MoveStage | null =>
  isTerminalRequestStatus(status) ? null : STAGE_BY_PENDING[status];
