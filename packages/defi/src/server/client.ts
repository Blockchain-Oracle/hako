import { LIFI_API_URL, LIFI_INTEGRATOR, LIFI_TIMEOUT_MS } from "@hako/config";
import { createClient, type SDKClient } from "@lifi/sdk";

import { MAX_ERROR_CAUSE_DEPTH } from "./defi.config.ts";

/**
 * The LI.FI SDK client (plan §3 Money row): core actions only — no wallet providers, no chain preload, no version
 * check — with Hako as the integrator and no integrator fee. One per process is enough.
 */
export function createLifiClient(options: { apiKey?: string } = {}): SDKClient {
  return createClient({
    integrator: LIFI_INTEGRATOR,
    apiKey: options.apiKey,
    apiUrl: LIFI_API_URL,
    preloadChains: false,
    providers: [],
    disableVersionCheck: true,
  });
}

export interface CallOptions {
  /** The caller's own cancellation (a closed request, a race that already has its winner). */
  signal?: AbortSignal;
  /** Defaults to LIFI_TIMEOUT_MS (4.5 s): the gateway answers inside the plugin's 7 s gateway budget. */
  timeoutMs?: number;
}

/** The caller's signal combined with the call's own timeout. */
export function callSignal(options: CallOptions = {}): AbortSignal {
  const timeout = AbortSignal.timeout(options.timeoutMs ?? LIFI_TIMEOUT_MS);
  return options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
}

/** True when `error`, or an error it wraps (the SDK wraps fetch's in `SDKError.cause`), is named `name`. */
function causedBy(error: unknown, name: string): boolean {
  let current = error;
  for (let depth = 0; current instanceof Error && depth < MAX_ERROR_CAUSE_DEPTH; depth += 1) {
    if (current.name === name) return true;
    current = current.cause;
  }
  return false;
}

/** The call ran out of its own time budget (LIFI_TIMEOUT_MS or `timeoutMs`), rather than LI.FI answering. */
export const isTimeout = (error: unknown): boolean => causedBy(error, "TimeoutError");
/** The caller's own signal cancelled the call. */
export const isAborted = (error: unknown): boolean => causedBy(error, "AbortError");
