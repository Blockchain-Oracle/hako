/**
 * PayBox request envelopes (`request_*`, `use_service`, `get_request`, `list_requests` rows) read into Hako's
 * `PayboxRequest`, and a request's status mapped onto the card contract (@hako/cards/contract: the status union, what a
 * pending status waits on, the card phase). Unknown statuses fail loudly instead of being guessed.
 */
import {
  isTerminalRequestStatus,
  payboxRequestStatusSchema,
  REQUEST_WAITS_ON,
  requestStatusToPhase,
  type CardPhase,
  type PayboxRequestStatus,
  type RequestWait,
} from "@hako/cards/contract";

import type { PayboxRequest } from "./intents/types.ts";

export class PayboxEnvelopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PayboxEnvelopeError";
  }
}

/** Hako's `PayboxRequest` plus what the money core needs to read back from PayBox's envelope. */
export interface PayboxRequestEnvelope extends PayboxRequest {
  /** PayBox: a terminal `error`/`denied` with `retryable: true` timed out before signing and spent nothing. */
  retryable: boolean;
  /** The request's kind on `list_requests` rows (`payment`, `wallet_sign`, `swap`…). */
  kind: string | null;
  completedAt: string | null;
}

type Json = Record<string, unknown>;
const record = (value: unknown): Json | null => (value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Json) : null);
const text = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);

/**
 * Reads one envelope. PayBox nests it under `response` in some results (a pending-funding plan): both shapes are read.
 * Throws PayboxEnvelopeError when there is no request id or the status is not one of PayBox's eight.
 */
export function parseRequestEnvelope(value: unknown): PayboxRequestEnvelope {
  const top = record(value);
  const body = top && typeof top.request_id === "string" ? top : record(top?.response);
  const requestId = text(body?.request_id);
  if (!body || !requestId) throw new PayboxEnvelopeError("PayBox's answer has no request id.");
  const status = payboxRequestStatusSchema.safeParse(body.status);
  if (!status.success) throw new PayboxEnvelopeError(`PayBox reported an unknown request status: ${String(body.status)}`);
  return {
    requestId,
    status: status.data,
    approvalUrl: text(body.approval_url),
    output: body.output ?? null,
    reason: text(body.reason) ?? text(body.error) ?? text(body.message),
    createdAt: text(body.created_at),
    retryable: body.retryable === true,
    kind: text(body.kind),
    completedAt: text(body.completed_at),
  };
}

/** What a card shows for a request's status: its phase, what a pending status waits on, whether polling stops. */
export interface RequestView {
  status: PayboxRequestStatus;
  phase: CardPhase;
  /** approval → "Approve in PayBox"; signature → PayBox's signing window; funding → "Add money"; … Null when terminal. */
  waitsOn: RequestWait | null;
  terminal: boolean;
}

export function requestView(status: PayboxRequestStatus): RequestView {
  const terminal = isTerminalRequestStatus(status);
  return {
    status,
    phase: requestStatusToPhase(status),
    waitsOn: terminal ? null : REQUEST_WAITS_ON[status as keyof typeof REQUEST_WAITS_ON],
    terminal,
  };
}
