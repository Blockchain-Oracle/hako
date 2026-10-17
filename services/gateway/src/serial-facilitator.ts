/**
 * Settle one payment at a time, and retry once when the facilitator loses a nonce race.
 *
 * A facilitator submits every settlement from one relayer account. Two settlements in flight at once get the
 * same account nonce, and the chain rejects the second ("replacement transaction underpriced"): the run succeeded,
 * the payer is not charged, and the answer is thrown away. Measured 2026-10-07 with two parallel chat tool calls.
 * Retrying is safe: the payer's EIP-3009 authorization carries its own nonce, so it can land at most once.
 */

import type { FacilitatorClient } from "@x402/core/server";

import { SETTLE_RACE_MARKERS, SETTLE_RETRY_ATTEMPTS, SETTLE_RETRY_DELAY_MS } from "./constants.js";

type Settle = FacilitatorClient["settle"];
type SettleResult = Awaited<ReturnType<Settle>>;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** True when the failure is the facilitator's own nonce collision, not a problem with the payment. */
function lostNonceRace(detail: unknown): boolean {
  const text = (detail instanceof Error ? `${detail.message} ${JSON.stringify(detail)}` : JSON.stringify(detail ?? ""))
    .toLowerCase();
  return SETTLE_RACE_MARKERS.some((marker) => text.includes(marker));
}

export class SerialFacilitator implements FacilitatorClient {
  private tail: Promise<unknown> = Promise.resolve();

  constructor(private readonly inner: FacilitatorClient) {}

  verify: FacilitatorClient["verify"] = (payload, requirements) => this.inner.verify(payload, requirements);

  getSupported: FacilitatorClient["getSupported"] = () => this.inner.getSupported();

  settle: Settle = (payload, requirements) => {
    const turn = this.tail.then(() => this.settleWithRetry(payload, requirements));
    this.tail = turn.catch(() => undefined); // one failed settlement must not block the queue
    return turn;
  };

  private async settleWithRetry(...args: Parameters<Settle>): Promise<SettleResult> {
    for (let attempt = 1; ; attempt += 1) {
      const last = attempt >= SETTLE_RETRY_ATTEMPTS;
      try {
        const result = await this.inner.settle(...args);
        if (result.success || last || !lostNonceRace(result)) return result;
      } catch (error) {
        if (last || !lostNonceRace(error)) throw error;
      }
      await sleep(SETTLE_RETRY_DELAY_MS);
    }
  }
}
