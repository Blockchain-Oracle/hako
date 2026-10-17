/** @hako/defi/server's own numbers (shared timeouts and TTLs come from @hako/config). */

/** USD fee and gas totals are summed exactly at this many decimals (LI.FI sends more; cents need far fewer). */
export const FEE_USD_DECIMALS = 6;
/** How deep `isTimeout`/`isAborted` follow `error.cause` (the SDK wraps fetch's error once). */
export const MAX_ERROR_CAUSE_DEPTH = 5;
