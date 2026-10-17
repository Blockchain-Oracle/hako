/**
 * Limits the card contract checks (plan §5b: feature-local numbers live in a `*.config.ts`). Shared constants that
 * other packages need too (timeouts, batch and invoice limits) stay in @hako/config and are imported from there.
 */

/** Next-step chips under a card (`envelope.suggestions[]`, plan §1 card flow step 5): a few, short. */
export const SUGGESTIONS_MAX = 3;
export const SUGGESTION_LABEL_MAX_CHARS = 40;
export const SUGGESTION_PROMPT_MAX_CHARS = 280;

/** A card action's button label ("Add money", "Raise my limit"). */
export const ACTION_LABEL_MAX_CHARS = 40;

/** Chain reads: one `eth_getLogs` page and one contract call's arguments. */
export const LOGS_MAX_ROWS = 200;
export const CONTRACT_ARGS_MAX = 16;

/** Activity and receipts pages (`GET /v1/receipts`, `hako_activity`). */
export const ACTIVITY_PAGE_DEFAULT = 20;
export const ACTIVITY_PAGE_MAX = 100;

/** Discover (`POST /v1/discover`, the api's DISCOVER_DEFAULT_LIMIT / DISCOVER_MAX_LIMIT / query cap). */
export const DISCOVER_LIMIT_DEFAULT = 5;
export const DISCOVER_LIMIT_MAX = 25;
export const DISCOVER_QUERY_MAX_CHARS = 300;
/** A catalog id `<provider>/<slug>` (the api's _ENDPOINT_ID_MAX). */
export const TOOL_ID_MAX_CHARS = 120;

/** Markets and Earn reads: rows one card asks for. */
export const MARKETS_LIMIT_DEFAULT = 5;
export const MARKETS_LIMIT_MAX = 20;
export const VAULTS_LIMIT_DEFAULT = 10;
export const VAULTS_LIMIT_MAX = 50;
export const MARKET_QUERY_MAX_CHARS = 200;

/** A signed transaction posted to `/v1/broadcast`: an EVM raw tx (hex) or a Solana tx (base64), with headroom. */
export const SIGNED_TX_MAX_CHARS = 65_536;

/** A contact's display name; a PayBox username. */
export const CONTACT_NAME_MAX_CHARS = 64;
export const PAYBOX_USERNAME_MAX_CHARS = 64;

/** Probabilities on a market card are fractions of one. */
export const PROBABILITY_MAX = 1;
/** A route race asks this many LI.FI bridges at most (one `/quote` each, in parallel). */
export const ROUTE_RACE_MAX_ROUTES = 12;
/** Extra time a streamed `/v1/routes` race gets past ROUTE_RACE_TOTAL_TIMEOUT_MS before the client gives up. */
export const ROUTE_STREAM_GRACE_MS = 1_500;

/** The gateway's x402 answer to an unpaid request: the client never pays, it reports the challenge. */
export const HTTP_PAYMENT_REQUIRED = 402;
export const HTTP_UNAUTHORIZED = 401;
