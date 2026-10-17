/**
 * Follows one PayBox request to a terminal status (plan D22: `get_request` from 1 s, backing off to 5 s, stopping at
 * `success`/`denied`/`error`). It only reads: PayBox's rule is "submit once, then poll", never re-call the operation.
 */
import { setTimeout as sleep } from "node:timers/promises";

import { isTerminalRequestStatus } from "@hako/cards/contract";
import { REQUEST_POLL_BACKOFF_FACTOR, REQUEST_POLL_INITIAL_MS, REQUEST_POLL_MAX_MS } from "@hako/config";

import type { PayboxRequestEnvelope } from "./status.ts";

export interface PollOptions {
  /** Stops waiting (the request keeps going in PayBox); the last snapshot is returned. */
  signal?: AbortSignal;
  /** Gives up after this long (ms) with the last snapshot; unset polls until terminal or aborted. */
  timeoutMs?: number;
  /** Called with every snapshot whose status changed (the card's live line). */
  onUpdate?: (request: PayboxRequestEnvelope) => void;
  initialMs?: number;
  maxMs?: number;
  factor?: number;
}

export interface PollResult {
  request: PayboxRequestEnvelope;
  /** False when the wait stopped (timeout or abort) before PayBox reached a terminal status. */
  terminal: boolean;
}

/** The waits between reads: initial, then × factor each time, capped at max (1 s, 2 s, 4 s, 5 s, 5 s…). */
export function* pollDelays(initialMs = REQUEST_POLL_INITIAL_MS, maxMs = REQUEST_POLL_MAX_MS, factor = REQUEST_POLL_BACKOFF_FACTOR): Generator<number> {
  let delay = initialMs;
  for (;;) {
    yield delay;
    delay = Math.min(delay * factor, maxMs);
  }
}

export async function pollRequest(getRequest: (requestId: string) => Promise<PayboxRequestEnvelope>, requestId: string, options: PollOptions = {}): Promise<PollResult> {
  const deadline = options.timeoutMs === undefined ? Number.POSITIVE_INFINITY : Date.now() + options.timeoutMs;
  let request = await getRequest(requestId);
  options.onUpdate?.(request);
  for (const delay of pollDelays(options.initialMs, options.maxMs, options.factor)) {
    if (isTerminalRequestStatus(request.status)) return { request, terminal: true };
    const wait = Math.min(delay, deadline - Date.now());
    if (wait <= 0 || options.signal?.aborted) return { request, terminal: false };
    try {
      await sleep(wait, undefined, { signal: options.signal });
    } catch {
      return { request, terminal: false };
    }
    const next = await getRequest(requestId);
    if (next.status !== request.status) options.onUpdate?.(next);
    request = next;
  }
  return { request, terminal: isTerminalRequestStatus(request.status) };
}
