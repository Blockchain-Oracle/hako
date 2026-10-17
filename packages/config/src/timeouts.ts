import { MS_PER_SECOND, SECONDS_PER_MINUTE } from "./units.ts";

/** PayBox gives each plugin operation ten seconds (plan §2, plugin limits). */
export const PLUGIN_OPERATION_BUDGET_MS = 10 * MS_PER_SECOND;
/**
 * The plugin makes one gateway call per tool, `AbortSignal.timeout(GATEWAY_TIMEOUT_MS)` with `redirect: 'error'`,
 * which leaves room inside the operation budget for building the proposal.
 */
export const GATEWAY_TIMEOUT_MS = 7 * MS_PER_SECOND;
/** The gateway bounds every LI.FI call (a `/quote` measured 1.5–2.2 s on 2026-10-17). */
export const LIFI_TIMEOUT_MS = 4_500;
/**
 * Rehearsal (`eth_simulateV1`, Solana `simulateTransaction`) gets this long; over budget the gateway returns the quote
 * with `rehearsal: {status: 'skipped', reason}` instead of running long.
 */
export const REHEARSAL_TIMEOUT_MS = 1_500;

/** Route race (plan add-ons): one LI.FI `/quote` per contender bridge in parallel, each bounded, the race bounded. */
export const ROUTE_RACE_ROUTE_TIMEOUT_MS = 4 * MS_PER_SECOND;
export const ROUTE_RACE_TOTAL_TIMEOUT_MS = 8 * MS_PER_SECOND;

/** A PayBox transaction proposal must expire in under five minutes (plan §2); this is the exclusive ceiling. */
export const PROPOSAL_EXPIRY_LIMIT_S = 5 * SECONDS_PER_MINUTE;
